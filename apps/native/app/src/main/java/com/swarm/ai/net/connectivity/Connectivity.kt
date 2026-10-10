package com.swarm.ai.net.connectivity

import com.swarm.ai.remote.PairingRecord
import com.swarm.ai.remote.QrPayload
import kotlinx.coroutines.CancellationException

/**
 * Entry point of the connectivity layer: `connectBest(...)` races all hosts of the QR / pairing record and
 * returns the first one that answers `GET /v1/ping` over TLS with the pinned certificate.
 * See INTEGRATION.md for how to wire it into RemoteClient.
 */

// ------------------------------------------------------------------ inputs

/** Minimal view of "where is the PC and which certificate must it present" (QR payload or pairing record). */
interface ConnectTarget {
    /** Host list in priority order, exactly as in the QR `hosts`. */
    val hosts: List<String>
    /** SHA-256 of the DER leaf certificate, lowercase hex (colons tolerated). */
    val fingerprint: String
}

data class SimpleConnectTarget(override val hosts: List<String>, override val fingerprint: String) : ConnectTarget

fun QrPayload.asConnectTarget(): ConnectTarget = SimpleConnectTarget(hosts, fingerprint)
fun PairingRecord.asConnectTarget(): ConnectTarget = SimpleConnectTarget(hosts, fingerprint)

/**
 * EXTENSION POINT for non-direct routes (WebRTC `rtc:...`, WireGuard, relay, ...). Host-list entries with an
 * unknown scheme prefix are offered to every registered factory; if one returns an attempt it joins the race
 * after the direct candidates. The attempt must authenticate the PC with the pinned fingerprint itself and
 * return a `baseUrl` that speaks the normal HTTPS REST/WebSocket API (e.g. a local forwarding endpoint).
 * No factory is registered by default, so such entries are only reported as UNSUPPORTED diagnostics.
 */
interface TransportFactory {
    fun supports(scheme: String): Boolean
    fun create(entry: String, scheme: String, fingerprint: String): ConnectAttempt?
}

/** Persists the last endpoint that worked, per PC (key = certificate fingerprint). */
interface EndpointMemory {
    fun get(fingerprint: String): String?
    fun put(fingerprint: String, rawHost: String)
    fun clear(fingerprint: String)
}

class InMemoryEndpointMemory : EndpointMemory {
    private val map = java.util.concurrent.ConcurrentHashMap<String, String>()
    private fun k(fp: String) = fp.lowercase().replace(":", "")
    override fun get(fingerprint: String): String? = map[k(fingerprint)]
    override fun put(fingerprint: String, rawHost: String) { map[k(fingerprint)] = rawHost }
    override fun clear(fingerprint: String) { map.remove(k(fingerprint)) }
}

/** SharedPreferences-backed [EndpointMemory] (not secret data: an address the user already pairs with). */
class SharedPrefsEndpointMemory(context: android.content.Context) : EndpointMemory {
    private val prefs = context.applicationContext.getSharedPreferences("swarm_connectivity", android.content.Context.MODE_PRIVATE)
    private fun k(fp: String) = "last_" + fp.lowercase().replace(":", "")
    override fun get(fingerprint: String): String? = prefs.getString(k(fingerprint), null)
    override fun put(fingerprint: String, rawHost: String) { prefs.edit().putString(k(fingerprint), rawHost).apply() }
    override fun clear(fingerprint: String) { prefs.edit().remove(k(fingerprint)).apply() }
}

/** Remember [endpoint] as the one to try first next time. */
fun rememberWorkingEndpoint(memory: EndpointMemory, fingerprint: String, endpoint: ConnectedEndpoint) {
    memory.put(fingerprint, endpoint.raw)
}

private object DefaultProbe {
    val instance: PingProbe by lazy { PinnedPingProbe() }
}

data class ConnectOptions(
    /** Try this host-list entry first (e.g. `PairingRecord.lastRoute`). Falls back to [memory] when null. */
    val lastKnownGood: String? = null,
    val memory: EndpointMemory? = null,
    /** Delay between starting consecutive candidates (a failed candidate starts the next one immediately). */
    val staggerMs: Long = 250,
    /** Per-candidate connect + TLS + ping budget. */
    val connectTimeoutMs: Long = 3000,
    /** Demote global-IPv6 candidates when the device has no global IPv6 (see [Ipv6Support] / [AndroidNetworks]). */
    val ipv6Available: Boolean = true,
    /** Cellular networks cannot reach the private LAN; start public routes immediately. */
    val preferLocal: Boolean = true,
    val transportFactories: List<TransportFactory> = emptyList(),
    /** Use `PinnedPingProbe(AndroidNetworks.bindToActiveNetwork(ctx))` to bind to the active network. */
    val probe: PingProbe = DefaultProbe.instance,
    /** Upper bound on raced candidates (the rest of a long list is reported as SKIPPED). */
    val maxCandidates: Int = MAX_HOST_ENTRIES,
    val clockMs: () -> Long = { System.nanoTime() / 1_000_000 }
)

// ------------------------------------------------------------------ outputs

data class ConnectedEndpoint(
    /** The host-list entry that won; pass it to [rememberWorkingEndpoint] / store as `lastRoute`. */
    val raw: String,
    val host: String,
    val port: Int,
    /** `https://host:port` base for REST and `wss://` for the WebSocket (same host/port). */
    val baseUrl: String,
    val label: String,
    val latencyMs: Long
) {
    val isIpv6: Boolean get() = host.contains(':')
    val display: String get() = if (isIpv6) "[$host]:$port" else "$host:$port"
}

data class CandidateDiagnostic(
    val raw: String,
    val label: String,
    val status: AttemptStatus,
    val startOffsetMs: Long?,
    val latencyMs: Long?,
    val errorKind: ProbeErrorKind?,
    val error: String?
) {
    fun oneLine(): String = buildString {
        append(raw).append(" [").append(label).append("] ").append(status.name.lowercase())
        if (latencyMs != null) append(" ").append(latencyMs).append(" ms")
        if (error != null) append(" - ").append(error)
    }
}

data class ConnectResult(
    val endpoint: ConnectedEndpoint?,
    val diagnostics: List<CandidateDiagnostic>,
    val totalMs: Long
) {
    val isSuccess: Boolean get() = endpoint != null

    /** Multi-line text for logs / a "connection details" dialog. */
    fun summary(): String = buildString {
        append(if (endpoint != null) "Connected via ${endpoint.display} (${endpoint.latencyMs} ms)" else "No route reachable")
        append(" in ").append(totalMs).append(" ms")
        diagnostics.forEach { append('\n').append("  ").append(it.oneLine()) }
    }

    /** A short user-facing hint for the "can't reach the PC" case, derived from the failures. */
    fun failureHint(): String {
        val real = diagnostics.filter { it.status == AttemptStatus.FAILED }
        return when {
            diagnostics.isEmpty() -> "The pairing data has no usable addresses."
            real.isNotEmpty() && real.all { it.errorKind == ProbeErrorKind.NETWORK_UNREACHABLE || it.errorKind == ProbeErrorKind.UNKNOWN_HOST } ->
                "No network connection."
            real.any { it.errorKind == ProbeErrorKind.CERT_MISMATCH } ->
                "A device answered but is not the paired PC (certificate changed). Pair again if you reinstalled SWARM on the PC."
            real.any { it.label == AddressKind.GLOBAL_IPV6.label && it.errorKind == ProbeErrorKind.TIMEOUT } ->
                "The public IPv6 address timed out before TLS. Confirm the PC bridge is listening and allow its TCP port in the PC and router IPv6 firewalls."
            real.any { it.label == AddressKind.GLOBAL_IPV6.label && it.errorKind == ProbeErrorKind.NETWORK_UNREACHABLE } ->
                "This phone network has no route to the paired PC's IPv6 address. A mapped public IPv4 route is also needed on networks without IPv6."
            real.any { it.errorKind == ProbeErrorKind.CONNECTION_REFUSED } ->
                "The address answered, but the SWARM bridge port refused the connection. Enable the bridge on the PC and check its port."
            else -> "No paired endpoint answered. Open connection details to see which address and network layer failed."
        }
    }
}

// ------------------------------------------------------------------ connectBest

/** Adapter for the existing QR model ([QrPayload]). */
suspend fun connectBest(qr: QrPayload, options: ConnectOptions = ConnectOptions()): ConnectResult =
    connectBest(qr.asConnectTarget(), options)

/** Adapter for a stored pairing (uses `lastRoute` as the last known good unless [options] set one). */
suspend fun connectBest(record: PairingRecord, options: ConnectOptions = ConnectOptions()): ConnectResult =
    connectBest(
        record.asConnectTarget(),
        if (options.lastKnownGood == null && record.lastRoute != null) options.copy(lastKnownGood = record.lastRoute) else options
    )

/**
 * Happy-eyeballs race over `target.hosts`; see [raceAttempts] for the timing rules.
 *
 * Never throws for network problems: inspect [ConnectResult.endpoint] (null = nothing reachable) and
 * [ConnectResult.diagnostics]. Throws [IllegalArgumentException] only for a missing/garbled fingerprint, and
 * propagates [CancellationException] (cancelling the caller cancels every in-flight probe).
 */
suspend fun connectBest(target: ConnectTarget, options: ConnectOptions = ConnectOptions()): ConnectResult {
    val fp = target.fingerprint.trim().lowercase().replace(":", "")
    require(Regex("^[0-9a-f]{64}$").matches(fp)) { "fingerprint must be 64 hex chars" }

    val parsed = HostParsing.parseHosts(target.hosts)
    val lastGood = options.lastKnownGood ?: options.memory?.get(fp)
    val ordered = HostParsing.order(parsed.candidates, lastGood, options.ipv6Available, preferLocal = options.preferLocal)

    val raced = ordered.take(options.maxCandidates)
    val overflow = ordered.drop(options.maxCandidates)
    val attempts = ArrayList<ConnectAttempt>()
    raced.forEach { attempts.add(DirectAttempt(it, fp, options.probe)) }

    val unsupportedDiag = ArrayList<CandidateDiagnostic>()
    for (u in parsed.unsupported) {
        val attempt = options.transportFactories.firstOrNull { it.supports(u.scheme) }?.create(u.raw, u.scheme, fp)
        if (attempt != null) attempts.add(attempt)
        else unsupportedDiag.add(
            CandidateDiagnostic(u.raw, "${u.scheme}:", AttemptStatus.UNSUPPORTED, null, null, null, "no transport for '${u.scheme}:' yet")
        )
    }

    val race = raceAttempts(attempts, options.staggerMs, options.connectTimeoutMs, options.clockMs)

    val diagnostics = ArrayList<CandidateDiagnostic>()
    race.reports.forEach {
        diagnostics.add(CandidateDiagnostic(it.id, it.label, it.status, it.startOffsetMs, it.latencyMs, it.errorKind, it.error))
    }
    overflow.forEach {
        diagnostics.add(CandidateDiagnostic(it.raw, it.kind.label, AttemptStatus.SKIPPED, null, null, null, "too many candidates"))
    }
    diagnostics.addAll(unsupportedDiag)
    parsed.invalid.forEach {
        diagnostics.add(CandidateDiagnostic(it.raw, "invalid", AttemptStatus.INVALID, null, null, null, it.reason))
    }

    val winner = race.winnerIndex?.let { idx ->
        val s = race.success!!
        val report = race.reports[idx]
        ConnectedEndpoint(
            raw = report.id, host = s.host, port = s.port, baseUrl = s.baseUrl,
            label = report.label, latencyMs = report.latencyMs ?: race.totalMs
        )
    }
    if (winner != null) options.memory?.let { rememberWorkingEndpoint(it, fp, winner) }
    return ConnectResult(winner, diagnostics, race.totalMs)
}

internal class DirectAttempt(
    private val candidate: Candidate,
    private val fingerprint: String,
    private val probe: PingProbe
) : ConnectAttempt {
    override val id: String get() = candidate.raw
    override val label: String get() = candidate.kind.label
    override suspend fun run(timeoutMs: Long): AttemptSuccess {
        probe.ping(candidate.baseUrl, fingerprint, timeoutMs)
        return AttemptSuccess(candidate.host, candidate.port, candidate.baseUrl)
    }
}

// ------------------------------------------------------------------ host list refresh

data class HostRefresh(
    val hosts: List<String>,
    val changed: Boolean,
    val added: List<String>,
    val removed: List<String>
)

/**
 * Refreshes the stored host list from what the PC reports about itself. Protocol v1 does NOT define a `hosts`
 * field on `GET /v1/status` yet (see INTEGRATION.md); the function is ready for when the PC adds one and is a
 * harmless no-op until then.
 *
 * [fetchStatusJson] must perform the authenticated `GET /v1/status` and return the raw JSON body (for example
 * `{ client.status().toString() }`), or null on failure. Never throws except for cancellation.
 */
suspend fun refreshHosts(
    current: List<String>,
    keepStale: Boolean = true,
    fetchStatusJson: suspend () -> String?
): HostRefresh {
    val body = try {
        fetchStatusJson()
    } catch (e: CancellationException) {
        throw e
    } catch (_: Exception) {
        null
    }
    val reported = body?.let { HostParsing.parseStatusHosts(it) }.orEmpty()
    if (reported.isEmpty()) return HostRefresh(current, false, emptyList(), emptyList())
    val merged = HostParsing.mergeHosts(current, reported, keepStale)
    val currentKeys = current.map { it.trim().lowercase() }.toSet()
    val mergedKeys = merged.map { it.lowercase() }.toSet()
    return HostRefresh(
        hosts = merged,
        changed = merged != current,
        added = merged.filter { it.lowercase() !in currentKeys },
        removed = current.filter { it.trim().lowercase() !in mergedKeys }
    )
}
