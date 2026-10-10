package com.swarm.ai.net.connectivity

/**
 * Pure-Kotlin host-list logic for the connectivity layer: parsing of QR `hosts` entries, classification,
 * ordering and merging. No Android / org.json / network dependencies -> plain JVM unit tests.
 *
 * Accepted entries (docs/REMOTE_PROTOCOL.md section 2):
 *  - `host:port`, `host` (default port 47821), `1.2.3.4:47821`
 *  - `[v6]:port`, `[v6]`, bare `v6` literal (default port)
 *  - `https://host[:port][/path]` (default port 443)
 * Entries with another scheme prefix (`rtc:...`, `wg://...`) are reported as [ParsedEntry.Unsupported] and can be
 * handled by a [TransportFactory]. `http://` is always rejected (plaintext is never used).
 */

const val DEFAULT_BARE_PORT = 47821
const val DEFAULT_HTTPS_PORT = 443
const val MAX_HOST_ENTRIES = 16

/** What kind of address a candidate is; drives the "LAN first, then IPv6, then the rest" ordering. */
enum class AddressKind(val label: String) {
    LAN_IPV4("Home network"),
    LAN_IPV6("Home network (IPv6)"),
    LAN_HOSTNAME("Home network (name)"),
    GLOBAL_IPV6("Public IPv6"),
    PUBLIC_IPV4("Public IPv4"),
    HOSTNAME("Hostname"),
    URL("Manual URL")
}

data class Candidate(
    /** The entry exactly as it appeared in the host list (use this as the persisted "last working" key). */
    val raw: String,
    val host: String,
    val port: Int,
    /** `https://host:port[/path]` without trailing slash; IPv6 hosts are bracketed. */
    val baseUrl: String,
    val isUrl: Boolean,
    val kind: AddressKind
) {
    val isIpv6: Boolean get() = host.contains(':')
    val display: String get() = if (isIpv6) "[$host]:$port" else "$host:$port"

    /** Normalised identity used for de-duplication and "same endpoint" comparisons. */
    val key: String get() = baseUrl.lowercase()
}

sealed class ParsedEntry {
    data class Direct(val candidate: Candidate) : ParsedEntry()
    /** Valid-looking entry with a scheme this layer does not speak itself (e.g. `rtc:`); see [TransportFactory]. */
    data class Unsupported(val raw: String, val scheme: String) : ParsedEntry()
    data class Invalid(val raw: String, val reason: String) : ParsedEntry()
}

data class ParsedHosts(
    val candidates: List<Candidate>,
    val unsupported: List<ParsedEntry.Unsupported>,
    val invalid: List<ParsedEntry.Invalid>
)

object HostParsing {
    private val SCHEME = Regex("^([A-Za-z][A-Za-z0-9+.-]*):")
    private val DIGITS = Regex("^\\d{1,5}$")
    private val V6_CHARS = Regex("^[0-9A-Fa-f:.]+$")
    private val HOSTNAME = Regex("^[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?$")
    private val IPV4 = Regex("^(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})$")

    fun parseEntry(input: String): ParsedEntry {
        val s = input.trim()
        if (s.isEmpty()) return ParsedEntry.Invalid(input, "empty")
        if (s.any { it.isWhitespace() }) return ParsedEntry.Invalid(input, "contains whitespace")
        val lower = s.lowercase()

        if (lower.startsWith("https://")) return parseUrl(s)
        if (lower.startsWith("http://")) return ParsedEntry.Invalid(input, "plaintext http is never used")

        if (!s.startsWith("[") && !looksLikeIpv6Literal(s)) {
            val m = SCHEME.find(s)
            if (m != null) {
                val rest = s.substring(m.range.last + 1)
                if (rest.isEmpty()) return ParsedEntry.Invalid(input, "missing port")
                if (!DIGITS.matches(rest)) return ParsedEntry.Unsupported(s, m.groupValues[1].lowercase())
            }
        }
        if (s.contains('/') || s.contains('?') || s.contains('#') || s.contains('@')) {
            return ParsedEntry.Invalid(input, "unexpected characters")
        }
        val (host, port) = parseAuthority(s, DEFAULT_BARE_PORT)
            ?: return ParsedEntry.Invalid(input, "not a host:port")
        val base = "https://${formatHost(host)}:$port"
        return ParsedEntry.Direct(Candidate(s, host, port, base, false, classifyHost(host)))
    }

    private fun parseUrl(s: String): ParsedEntry {
        val rest = s.substring(8)
        if (rest.isEmpty()) return ParsedEntry.Invalid(s, "empty url")
        if (rest.any { it == '?' || it == '#' || it == '@' }) return ParsedEntry.Invalid(s, "unexpected characters")
        val authority = rest.substringBefore('/')
        val path = rest.substring(authority.length).trimEnd('/')
        val (host, port) = parseAuthority(authority, DEFAULT_HTTPS_PORT)
            ?: return ParsedEntry.Invalid(s, "bad url authority")
        val portPart = if (port == DEFAULT_HTTPS_PORT) "" else ":$port"
        val base = "https://${formatHost(host)}$portPart$path"
        return ParsedEntry.Direct(Candidate(s, host, port, base, true, urlKind(host)))
    }

    /** A URL entry keeps its address-based kind when it is a LAN address, otherwise it is a manual URL. */
    private fun urlKind(host: String): AddressKind {
        val k = classifyHost(host)
        return when (k) {
            AddressKind.LAN_IPV4, AddressKind.LAN_IPV6, AddressKind.LAN_HOSTNAME -> k
            else -> AddressKind.URL
        }
    }

    fun parseHosts(hosts: List<String>): ParsedHosts {
        val cands = LinkedHashMap<String, Candidate>()
        val unsupported = ArrayList<ParsedEntry.Unsupported>()
        val invalid = ArrayList<ParsedEntry.Invalid>()
        for (h in hosts) {
            when (val e = parseEntry(h)) {
                is ParsedEntry.Direct -> cands.putIfAbsent(e.candidate.key, e.candidate)
                is ParsedEntry.Unsupported -> if (unsupported.none { it.raw.equals(e.raw, true) }) unsupported.add(e)
                is ParsedEntry.Invalid -> invalid.add(e)
            }
        }
        return ParsedHosts(cands.values.toList(), unsupported, invalid)
    }

    // ------------------------------------------------------------ host / port syntax

    fun looksLikeIpv6Literal(s: String): Boolean = s.count { it == ':' } >= 2 && V6_CHARS.matches(s)

    /** Splits `host`, `host:port`, `[v6]`, `[v6]:port` or a bare v6 literal. Returns null when malformed. */
    fun parseAuthority(a: String, defaultPort: Int): Pair<String, Int>? {
        val host: String
        var port = defaultPort
        if (a.startsWith("[")) {
            val end = a.indexOf(']')
            if (end < 2) return null
            host = a.substring(1, end)
            val rest = a.substring(end + 1)
            if (rest.isNotEmpty()) {
                if (!rest.startsWith(":")) return null
                port = parsePort(rest.substring(1)) ?: return null
            }
            if (!(host.count { it == ':' } >= 2 && V6_CHARS.matches(host))) return null
        } else {
            val colons = a.count { it == ':' }
            when {
                colons == 0 -> host = a
                colons == 1 -> {
                    host = a.substringBefore(':')
                    port = parsePort(a.substringAfter(':')) ?: return null
                }
                else -> {
                    host = a
                    if (!looksLikeIpv6Literal(a)) return null
                }
            }
            if (!host.contains(':') && !HOSTNAME.matches(host)) return null
        }
        if (host.isEmpty()) return null
        return host to port
    }

    private fun parsePort(s: String): Int? {
        if (!DIGITS.matches(s)) return null
        val p = s.toInt()
        return if (p in 1..65535) p else null
    }

    fun formatHost(host: String): String = if (host.contains(':')) "[$host]" else host

    // ------------------------------------------------------------ classification

    fun isIpv4(host: String): Boolean {
        val m = IPV4.matchEntire(host) ?: return false
        return m.groupValues.drop(1).all { it.toInt() in 0..255 }
    }

    /** RFC1918, link-local, CGNAT/VPN overlay (100.64/10, e.g. Tailscale) and loopback. */
    fun isPrivateIpv4(host: String): Boolean {
        if (!isIpv4(host)) return false
        val p = host.split('.').map { it.toInt() }
        return p[0] == 10 ||
            (p[0] == 172 && p[1] in 16..31) ||
            (p[0] == 192 && p[1] == 168) ||
            (p[0] == 169 && p[1] == 254) ||
            (p[0] == 100 && p[1] in 64..127) ||
            p[0] == 127
    }

    /** Loopback, link-local (fe80::/10), unique-local (fc00::/7) and IPv4-mapped private addresses. */
    fun isPrivateIpv6(host: String): Boolean {
        val h = host.lowercase()
        if (h == "::1") return true
        if (h.startsWith("::ffff:")) {
            val v4 = h.removePrefix("::ffff:")
            if (isIpv4(v4)) return isPrivateIpv4(v4)
        }
        val first = h.substringBefore(':')
        if (first.isEmpty()) return false // "::" prefixed, e.g. ::2 -> treat as global/unknown
        val v = first.toIntOrNull(16) ?: return false
        return (v and 0xfe00) == 0xfc00 || (v and 0xffc0) == 0xfe80
    }

    fun classifyHost(host: String): AddressKind {
        if (host.contains(':')) return if (isPrivateIpv6(host)) AddressKind.LAN_IPV6 else AddressKind.GLOBAL_IPV6
        if (isIpv4(host)) return if (isPrivateIpv4(host)) AddressKind.LAN_IPV4 else AddressKind.PUBLIC_IPV4
        val l = host.lowercase()
        val lan = !l.contains('.') || l.endsWith(".local") || l.endsWith(".lan") ||
            l.endsWith(".home.arpa") || l.endsWith(".internal") || l.endsWith(".localdomain")
        return if (lan) AddressKind.LAN_HOSTNAME else AddressKind.HOSTNAME
    }

    // ------------------------------------------------------------ ordering

    /**
     * Rank used for the staggered start order (lower starts earlier):
     * 0 last known good, 1 LAN/private, 2 global IPv6, 3 everything else (public IPv4, names, URLs).
     * When the device has no global IPv6 ([ipv6Available] = false) global IPv6 candidates drop to rank 4: they
     * are still tried (cheap, fail fast with "network unreachable") but never delay the others.
     */
    fun rank(c: Candidate, isLastGood: Boolean, ipv6Available: Boolean, preferLocal: Boolean = true): Int = when {
        isLastGood -> 0
        c.kind == AddressKind.LAN_IPV4 || c.kind == AddressKind.LAN_IPV6 || c.kind == AddressKind.LAN_HOSTNAME -> if (preferLocal) 1 else 5
        c.kind == AddressKind.GLOBAL_IPV6 -> if (ipv6Available) 2 else 4
        else -> 3
    }

    /**
     * Orders candidates for a race: [lastGood] (matched on normalised address, added at the front if it is not
     * in [candidates] but parses as a direct endpoint) first, then by [rank]; the QR order is preserved inside
     * a rank (the sort is stable).
     */
    fun order(
        candidates: List<Candidate>,
        lastGood: String? = null,
        ipv6Available: Boolean = true,
        includeLastGoodIfMissing: Boolean = true,
        preferLocal: Boolean = true
    ): List<Candidate> {
        val lg = lastGood?.let { (parseEntry(it) as? ParsedEntry.Direct)?.candidate }
        val list = ArrayList(candidates)
        if (lg != null && includeLastGoodIfMissing && list.none { it.key == lg.key }) list.add(lg)
        return list.sortedBy { rank(it, lg != null && it.key == lg.key, ipv6Available, preferLocal) }
    }

    // ------------------------------------------------------------ host list refresh

    /**
     * Merges a host list reported by the PC ([reported], authoritative order) into the stored list ([current]).
     * Reported entries come first; with [keepStale] previously known entries that are no longer reported follow
     * (they may be manual / DDNS routes the PC does not know about). Invalid entries are dropped, duplicates
     * collapsed, result capped at [max].
     */
    fun mergeHosts(current: List<String>, reported: List<String>, keepStale: Boolean = true, max: Int = MAX_HOST_ENTRIES): List<String> {
        val seen = HashSet<String>()
        val out = ArrayList<String>()
        fun add(raw: String) {
            val id = when (val e = parseEntry(raw)) {
                is ParsedEntry.Direct -> e.candidate.key
                is ParsedEntry.Unsupported -> "u:" + e.raw.lowercase()
                is ParsedEntry.Invalid -> return
            }
            if (seen.add(id)) out.add(raw.trim())
        }
        reported.forEach(::add)
        if (keepStale || reported.isEmpty()) current.forEach(::add)
        return out.take(max)
    }

    /**
     * Extracts the `hosts` string array from a `/v1/status` style JSON body without any JSON library
     * (protocol v1 does not define the field yet; returns an empty list when absent).
     */
    fun parseStatusHosts(json: String): List<String> {
        val m = Regex("\"hosts\"\\s*:\\s*\\[").find(json) ?: return emptyList()
        val out = ArrayList<String>()
        var i = m.range.last + 1
        while (i < json.length) {
            when (json[i]) {
                ']' -> return out
                '"' -> {
                    val sb = StringBuilder()
                    i++
                    while (i < json.length && json[i] != '"') {
                        if (json[i] == '\\' && i + 1 < json.length) i++
                        sb.append(json[i])
                        i++
                    }
                    out.add(sb.toString())
                }
            }
            i++
        }
        return out
    }
}
