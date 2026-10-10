package com.swarm.ai.net.connectivity

import com.swarm.ai.remote.FingerprintTrustManager
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Dns
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import java.io.IOException
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import javax.net.SocketFactory
import javax.net.ssl.SSLContext
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** Optional binding of probe sockets / DNS lookups to a specific Android [android.net.Network]. */
class NetworkBinding(val socketFactory: SocketFactory, val dns: Dns? = null, val identity: String = "default")

/** Result of a successful `/v1/ping`. */
data class PingInfo(val protocolVersion: Int?)

/** `GET <baseUrl>/v1/ping` over pinned TLS. Abstracted so the race logic can be tested without a network. */
fun interface PingProbe {
    /** Returns only if the peer presented the pinned certificate AND answered `{"ok":true}`; throws otherwise. */
    suspend fun ping(baseUrl: String, fingerprint: String, timeoutMs: Long): PingInfo
}

/**
 * Production [PingProbe] (OkHttp). Trust is restricted to the pinned certificate fingerprint using the app's
 * existing [FingerprintTrustManager] (SHA-256 of the leaf cert DER; no system CAs, never trust-all); hostname
 * verification is skipped because hosts are bare IPs and the fingerprint authenticates the PC.
 *
 * Cancelling the calling coroutine cancels the in-flight OkHttp call (closing the socket).
 */
class PinnedPingProbe(private val binding: NetworkBinding? = null) : PingProbe {
    private val clients = ConcurrentHashMap<String, OkHttpClient>()

    private fun baseClient(fp: String): OkHttpClient = clients.getOrPut(fp.lowercase().replace(":", "")) {
        val tm = FingerprintTrustManager(fp)
        val ctx = SSLContext.getInstance("TLS").apply { init(null, arrayOf(tm), SecureRandom()) }
        OkHttpClient.Builder()
            .sslSocketFactory(ctx.socketFactory, tm)
            .hostnameVerifier { _, _ -> true }
            .protocols(listOf(Protocol.HTTP_1_1))
            .followRedirects(false)
            .followSslRedirects(false)
            .retryOnConnectionFailure(false)
            .apply {
                binding?.let { b ->
                    socketFactory(b.socketFactory)
                    b.dns?.let { dns(it) }
                }
            }
            .build()
    }

    override suspend fun ping(baseUrl: String, fingerprint: String, timeoutMs: Long): PingInfo {
        require(fingerprint.isNotBlank()) { "fingerprint required" }
        val url = try {
            (baseUrl.trimEnd('/') + "/v1/ping").toHttpUrl()
        } catch (e: IllegalArgumentException) {
            throw ConnectAttemptException(ProbeErrorKind.INVALID_ADDRESS, "invalid address", e)
        }
        val client = baseClient(fingerprint).newBuilder()
            .connectTimeout(timeoutMs, TimeUnit.MILLISECONDS)
            .readTimeout(timeoutMs, TimeUnit.MILLISECONDS)
            .writeTimeout(timeoutMs, TimeUnit.MILLISECONDS)
            .callTimeout(timeoutMs + 1000, TimeUnit.MILLISECONDS)
            .build()
        val request = Request.Builder().url(url).header("Connection", "close").get().build()
        val (code, body) = execute(client.newCall(request))
        if (code !in 200..299) throw ConnectAttemptException(ProbeErrorKind.HTTP_STATUS, "HTTP $code")
        return parsePingBody(body) ?: throw ConnectAttemptException(ProbeErrorKind.BAD_RESPONSE, "unexpected ping body")
    }

    private suspend fun execute(call: Call): Pair<Int, String> = suspendCancellableCoroutine { cont ->
        cont.invokeOnCancellation { call.cancel() }
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                if (cont.isActive) cont.resumeWithException(e)
            }

            override fun onResponse(call: Call, response: Response) {
                response.use { r ->
                    try {
                        val text = r.peekBody(4096).string()
                        if (cont.isActive) cont.resume(r.code to text)
                    } catch (e: IOException) {
                        if (cont.isActive) cont.resumeWithException(e)
                    }
                }
            }
        })
    }

    companion object {
        private val OK = Regex("\"ok\"\\s*:\\s*true")
        private val V = Regex("\"v\"\\s*:\\s*(\\d+)")

        /** Pure: validates a `/v1/ping` body (`{"ok":true,"v":1}`); null when it is not one. */
        fun parsePingBody(body: String): PingInfo? {
            if (!OK.containsMatchIn(body)) return null
            return PingInfo(V.find(body)?.groupValues?.get(1)?.toIntOrNull())
        }
    }
}
