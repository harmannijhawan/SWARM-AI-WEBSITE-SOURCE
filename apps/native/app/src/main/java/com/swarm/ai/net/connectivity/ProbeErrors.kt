package com.swarm.ai.net.connectivity

import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.security.cert.CertificateException
import javax.net.ssl.SSLException

/** Why a candidate failed; meant for UI hints and logs (never contains secrets). */
enum class ProbeErrorKind(val hint: String) {
    TIMEOUT("timed out"),
    UNKNOWN_HOST("name not found"),
    NETWORK_UNREACHABLE("network unreachable"),
    CONNECTION_REFUSED("connection refused"),
    CERT_MISMATCH("certificate does not match the paired PC"),
    TLS("TLS error"),
    HTTP_STATUS("unexpected HTTP status"),
    BAD_RESPONSE("not a SWARM bridge"),
    INVALID_ADDRESS("invalid address"),
    OTHER("failed")
}

/** Thrown by probes for failures that are not plain I/O exceptions. */
class ConnectAttemptException(val kind: ProbeErrorKind, message: String, cause: Throwable? = null) : Exception(message, cause)

object ProbeErrors {
    private val UNREACHABLE_MARKERS = listOf(
        "network is unreachable", "enetunreach", "no route to host", "ehostunreach",
        "address family not supported", "eafnosupport", "network unreachable", "cannot assign requested address",
        "eaddrnotavail"
    )
    private val TIMEOUT_REGEX = Regex("(timed out|timeout|after \\d+ms)", RegexOption.IGNORE_CASE)

    fun causeChain(t: Throwable): List<Throwable> {
        val out = ArrayList<Throwable>()
        var cur: Throwable? = t
        while (cur != null && out.size < 8 && out.none { it === cur }) {
            out.add(cur)
            cur = cur.cause
        }
        return out
    }

    fun classify(t: Throwable): ProbeErrorKind {
        val chain = causeChain(t)
        chain.firstOrNull { it is ConnectAttemptException }?.let { return (it as ConnectAttemptException).kind }
        if (chain.any { it is CertificateException || it.message?.contains("fingerprint mismatch", true) == true }) {
            return ProbeErrorKind.CERT_MISMATCH
        }
        if (chain.any { it is UnknownHostException }) return ProbeErrorKind.UNKNOWN_HOST
        if (chain.any { it is NoRouteToHostException }) return ProbeErrorKind.NETWORK_UNREACHABLE
        if (chain.any { c -> c.message?.lowercase()?.let { m -> UNREACHABLE_MARKERS.any { m.contains(it) } } == true }) {
            return ProbeErrorKind.NETWORK_UNREACHABLE
        }
        if (chain.any { it.message?.contains("refused", true) == true || it.message?.contains("econnrefused", true) == true }) {
            return ProbeErrorKind.CONNECTION_REFUSED
        }
        if (chain.any { it is SocketTimeoutException || (it is ConnectException && TIMEOUT_REGEX.containsMatchIn(it.message ?: "")) } ||
            chain.any { it is java.io.InterruptedIOException && TIMEOUT_REGEX.containsMatchIn(it.message ?: "") }
        ) {
            return ProbeErrorKind.TIMEOUT
        }
        if (chain.any { it is SSLException }) return ProbeErrorKind.TLS
        if (chain.any { it is IllegalArgumentException }) return ProbeErrorKind.INVALID_ADDRESS
        return ProbeErrorKind.OTHER
    }

    /** Short single-line description safe to show in a diagnostics list. */
    fun describe(t: Throwable): String {
        val kind = classify(t)
        val detail = (t.message ?: t.javaClass.simpleName).lineSequence().firstOrNull().orEmpty().take(120)
        return if (kind == ProbeErrorKind.OTHER || kind == ProbeErrorKind.TLS) "${kind.hint}: $detail" else kind.hint
    }
}
