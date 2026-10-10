package com.swarm.ai.remote

import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.util.Base64

/** Pure-Kotlin protocol helpers (see docs/REMOTE_PROTOCOL.md). No Android framework dependencies, unit-testable. */

const val DEFAULT_PORT = 47821
const val PROTOCOL_VERSION = 1

// ------------------------------------------------------------------ codecs

object Codec {
    fun b64(bytes: ByteArray): String = Base64.getEncoder().encodeToString(bytes)
    fun b64Url(bytes: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    fun sha256(bytes: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(bytes)
    fun sha256Hex(bytes: ByteArray): String = sha256(bytes).joinToString("") { "%02x".format(it) }
}

// ------------------------------------------------------------------ QR payload

data class QrPayload(
    val version: Int,
    val hosts: List<String>,
    val fingerprint: String,
    val token: String,
    val pcName: String
)

class QrParseException(message: String) : Exception(message)

object QrPayloadParser {
    private val FP_REGEX = Regex("^[0-9a-f]{64}$")
    private const val MAX_LEN = 8192

    /** Parses and validates the QR text. Throws [QrParseException] with a user-presentable message. */
    fun parse(text: String): QrPayload {
        val raw = text.trim()
        if (raw.isEmpty() || raw.length > MAX_LEN) throw QrParseException("This is not a SWARM pairing code.")
        val o = try {
            JSONObject(raw)
        } catch (e: Exception) {
            throw QrParseException("This is not a SWARM pairing code.")
        }
        val v = o.optInt("v", -1)
        if (v != PROTOCOL_VERSION) throw QrParseException("Unsupported pairing code version ($v). Update the app or the PC.")

        val arr: JSONArray = o.optJSONArray("hosts") ?: throw QrParseException("Pairing code has no addresses.")
        val hosts = ArrayList<String>()
        for (i in 0 until arr.length()) {
            val h = arr.optString(i, "").trim()
            if (h.isNotEmpty() && HostEndpoint.parseOrNull(h) != null && h !in hosts) hosts.add(h)
        }
        if (hosts.isEmpty()) throw QrParseException("Pairing code has no usable addresses.")

        val fp = o.optString("fp", "").trim().lowercase().replace(":", "")
        if (!FP_REGEX.matches(fp)) throw QrParseException("Pairing code has an invalid certificate fingerprint.")

        val tok = o.optString("tok", "").trim()
        if (tok.isEmpty() || tok.length > 512) throw QrParseException("Pairing code has no token.")

        val name = if (o.isNull("name")) "" else o.optString("name", "").trim()
        return QrPayload(v, hosts, fp, tok, name.ifEmpty { "PC" })
    }
}

// ------------------------------------------------------------------ hosts / routes

data class HostEndpoint(
    val raw: String,
    val baseUrl: String,
    val host: String,
    val port: Int,
    val isUrl: Boolean
) {
    val isIpv6: Boolean get() = host.contains(':')
    val display: String get() = if (isUrl) baseUrl.removePrefix("https://") else if (isIpv6) "[$host]:$port" else "$host:$port"

    companion object {
        private val IPV4 = Regex("^(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})$")

        fun parseOrNull(input: String): HostEndpoint? {
            val s = input.trim()
            if (s.isEmpty() || s.any { it.isWhitespace() }) return null
            if (s.startsWith("http://", ignoreCase = true)) return null // plaintext is never used
            if (s.startsWith("https://", ignoreCase = true)) {
                val rest = s.substring(8).trimEnd('/')
                if (rest.isEmpty()) return null
                val authority = rest.substringBefore('/')
                val parsed = parseAuthority(authority, 443) ?: return null
                return HostEndpoint(s, "https://$rest", parsed.first, parsed.second, true)
            }
            if (s.contains('/')) return null
            val (host, port) = parseAuthority(s, DEFAULT_PORT) ?: return null
            val hostPart = if (host.contains(':')) "[$host]" else host
            return HostEndpoint(s, "https://$hostPart:$port", host, port, false)
        }

        private fun parseAuthority(a: String, defaultPort: Int): Pair<String, Int>? {
            val host: String
            var port = defaultPort
            if (a.startsWith("[")) {
                val end = a.indexOf(']')
                if (end < 2) return null
                host = a.substring(1, end)
                val rest = a.substring(end + 1)
                if (rest.isNotEmpty()) {
                    if (!rest.startsWith(":")) return null
                    port = rest.substring(1).toIntOrNull() ?: return null
                }
            } else {
                val colons = a.count { it == ':' }
                when {
                    colons == 0 -> host = a
                    colons == 1 -> {
                        host = a.substringBefore(':')
                        port = a.substringAfter(':').toIntOrNull() ?: return null
                    }
                    else -> host = a // bare IPv6 literal without brackets, default port
                }
            }
            if (host.isEmpty() || port !in 1..65535) return null
            return host to port
        }

        fun isPrivateIpv4(host: String): Boolean {
            val m = IPV4.matchEntire(host) ?: return false
            val p = m.groupValues.drop(1).map { it.toInt() }
            if (p.any { it > 255 }) return false
            return p[0] == 10 ||
                (p[0] == 172 && p[1] in 16..31) ||
                (p[0] == 192 && p[1] == 168) ||
                (p[0] == 169 && p[1] == 254) ||
                (p[0] == 100 && p[1] in 64..127) || // VPN overlay ranges (e.g. Tailscale)
                p[0] == 127
        }

        fun isIpv4(host: String) = IPV4.matches(host)
    }
}

/** Neutral route labels shown in the UI. */
enum class RouteKind(val label: String) {
    HOME_NETWORK("Home network"),
    PUBLIC_IPV6("Public IPv6"),
    MAPPED_PORT("Mapped port"),
    MANUAL("Manual")
}

data class Route(val endpoint: HostEndpoint, val kind: RouteKind) {
    val label: String get() = kind.label
}

object RouteClassifier {
    /** Classifies hosts, keeping their order (QR order == priority order). */
    fun classify(hosts: List<String>): List<Route> {
        var seenMapped = false
        val out = ArrayList<Route>()
        for (h in hosts) {
            val ep = HostEndpoint.parseOrNull(h) ?: continue
            val kind = when {
                ep.isUrl -> RouteKind.MANUAL
                ep.isIpv6 -> {
                    val lower = ep.host.lowercase()
                    if (lower.startsWith("fe80") || lower.startsWith("fc") || lower.startsWith("fd") || lower == "::1")
                        RouteKind.HOME_NETWORK else RouteKind.PUBLIC_IPV6
                }
                HostEndpoint.isIpv4(ep.host) && HostEndpoint.isPrivateIpv4(ep.host) -> RouteKind.HOME_NETWORK
                HostEndpoint.isIpv4(ep.host) && !seenMapped -> {
                    seenMapped = true
                    RouteKind.MAPPED_PORT
                }
                else -> RouteKind.MANUAL
            }
            out.add(Route(ep, kind))
        }
        return out
    }
}

// ------------------------------------------------------------------ agents

data class RemoteAgent(
    val id: String,
    val name: String,
    val status: String,
    val task: String?,
    val updatedAt: String?
)

object RemoteJson {
    fun parseAgent(o: JSONObject): RemoteAgent? {
        val id = o.optString("id", "")
        if (id.isEmpty()) return null
        return RemoteAgent(
            id = id,
            name = o.optString("name", id).ifEmpty { id },
            status = o.optString("status", "idle"),
            task = if (o.isNull("task")) null else o.optString("task", "").ifEmpty { null },
            updatedAt = if (o.isNull("updatedAt")) null else o.optString("updatedAt", "").ifEmpty { null }
        )
    }

    fun parseAgents(o: JSONObject): List<RemoteAgent> {
        val arr = o.optJSONArray("agents") ?: return emptyList()
        val out = ArrayList<RemoteAgent>()
        for (i in 0 until arr.length()) {
            arr.optJSONObject(i)?.let { parseAgent(it) }?.let { out.add(it) }
        }
        return out
    }
}

// ------------------------------------------------------------------ request signing

fun interface Signer {
    /** Returns an ASN.1 DER ECDSA (SHA256withECDSA) signature. */
    fun sign(data: ByteArray): ByteArray
}

class RequestSigner(
    private val deviceId: String,
    private val deviceSecret: String,
    private val signer: Signer,
    private val clock: () -> Long = { System.currentTimeMillis() },
    private val nonce: () -> String = {
        val b = ByteArray(16)
        java.security.SecureRandom().nextBytes(b)
        Codec.b64Url(b)
    }
) {
    fun canonical(method: String, target: String, timestamp: String, nonce: String, body: ByteArray): String =
        listOf(
            "SWARM-REQ-1",
            method.uppercase(),
            target,
            timestamp,
            nonce,
            deviceId,
            Codec.sha256Hex(body)
        ).joinToString("\n")

    /** Headers required on every authenticated request / WebSocket upgrade. */
    fun headers(method: String, target: String, body: ByteArray = ByteArray(0)): Map<String, String> {
        val ts = clock().toString()
        val n = nonce()
        val sig = Codec.b64Url(signer.sign(canonical(method, target, ts, n, body).toByteArray(Charsets.UTF_8)))
        return mapOf(
            "Authorization" to "Bearer $deviceId.$deviceSecret",
            "X-Swarm-Timestamp" to ts,
            "X-Swarm-Nonce" to n,
            "X-Swarm-Signature" to sig
        )
    }

    companion object {
        fun pairProofPayload(token: String, deviceId: String, publicKeyB64: String): String =
            "SWARM-PAIR-1\n$token\n$deviceId\n$publicKeyB64"
    }
}