package com.swarm.ai.remote

import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.CancellationException
import com.swarm.ai.net.connectivity.NetworkBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.json.JSONObject
import java.io.IOException
import java.net.URLEncoder
import java.security.MessageDigest
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager

// ------------------------------------------------------------------ errors

sealed class RemoteException(message: String, cause: Throwable? = null) : Exception(message, cause) {
    /** Credentials rejected / device revoked on the PC -> the app must return to the scan screen. */
    class Unauthorized : RemoteException("This phone is no longer paired with the PC.")
    class RateLimited(val retryAfterSec: Int) : RemoteException("Too many attempts. Try again in $retryAfterSec s.")
    class NoRoute(detail: String = "Can't reach the PC right now.") : RemoteException(detail)
    class Network(cause: Throwable?) : RemoteException("Connection problem: ${cause?.message ?: "unknown"}", cause)
    class Http(val code: Int, val error: String?) : RemoteException(describe(code, error)) {
        companion object {
            fun describe(code: Int, error: String?) = when (error) {
                "invalid_token" -> "The pairing code was rejected (expired or already used). Show a new code on the PC."
                "device_exists" -> "This device is already paired."
                "agent_not_found" -> "That project no longer exists on the PC."
                "invalid_state" -> "That action is not possible in the current state."
                "bad_request" -> "The PC did not accept the request."
                else -> "PC returned an error ($code${error?.let { ": $it" } ?: ""})."
            }
        }
    }
}

// ------------------------------------------------------------------ transport abstraction

class HttpResult(val code: Int, val body: String, val retryAfterSec: Int? = null) {
    val isSuccess get() = code in 200..299
    fun json(): JSONObject = try { JSONObject(body) } catch (e: Exception) { JSONObject() }
}

sealed class WsEvent {
    object Open : WsEvent()
    data class Hello(val pcName: String, val hosts: List<String> = emptyList()) : WsEvent()
    data class Agents(val agents: List<RemoteAgent>) : WsEvent()
    data class DesktopFrame(val sequence: Int, val width: Int, val height: Int, val jpegData: ByteArray, val timestamp: Long = 0) : WsEvent()
    data class CommandAck(val id: String, val ok: Boolean, val error: String?) : WsEvent()
    data class AppUpdate(val channel: String, val payload: Any?) : WsEvent()
    data class Activity(val event: JSONObject) : WsEvent()
    data class Approvals(val approvals: List<JSONObject>) : WsEvent()
    data class DesktopError(val error: String) : WsEvent()
    data class Closed(val code: Int) : WsEvent()
    data class Failure(val error: Throwable) : WsEvent()
}

/**
 * Wire-level access to one resolved [Route]. Other transports (e.g. a future tunnel) can implement this
 * together with a matching [RouteConnector].
 */
interface RemoteTransport {
    fun disconnect() {}
    /** `GET /v1/ping` with certificate pinning to [fingerprint]. */
    suspend fun ping(route: Route, fingerprint: String, timeoutMs: Int): Boolean

    /** Unauthenticated JSON POST (pairing). */
    suspend fun postUnauthenticated(route: Route, fingerprint: String, path: String, body: String): HttpResult

    /** Authenticated request; [headers] must already include the auth/signature headers for exactly ([method],[target],[body]). */
    suspend fun request(route: Route, fingerprint: String, method: String, path: String, body: ByteArray?, signer: RequestSigner): HttpResult

    /** Opens the authenticated `/v1/ws` stream; cancelling the collector closes the socket. */
    fun events(route: Route, fingerprint: String, signer: RequestSigner): Flow<WsEvent>
    
    /** Send a command through the WebSocket (requires active WebSocket connection from events()). */
    suspend fun sendCommand(cmd: String, args: Map<String, Any?>): Boolean
}

// ------------------------------------------------------------------ certificate pinning

/** Trusts exactly one leaf certificate, identified by the SHA-256 of its DER encoding. No CA trust, no trust-all. */
class FingerprintTrustManager(expectedHex: String) : X509TrustManager {
    private val expected = expectedHex.lowercase().replace(":", "")

    override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {
        throw CertificateException("Client certificates are not supported")
    }

    override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
        if (chain.isNullOrEmpty()) throw CertificateException("Empty certificate chain")
        val actual = Codec.sha256Hex(chain[0].encoded)
        if (!MessageDigest.isEqual(actual.toByteArray(), expected.toByteArray())) {
            throw CertificateException("Certificate fingerprint mismatch")
        }
    }

    override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
}

private val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()

class OkHttpTransport(private val networkBinding: () -> NetworkBinding? = { null }) : RemoteTransport {
    override fun disconnect() { activeWebSocket?.cancel(); activeWebSocket = null; pending.values.forEach { it.completeExceptionally(RemoteException.NoRoute("The network changed.")) }; pending.clear() }
    private val clients = ConcurrentHashMap<String, OkHttpClient>()
    @Volatile private var activeWebSocket: WebSocket? = null
    private var commandCounter = 0
    private val pending = ConcurrentHashMap<String, CompletableDeferred<Boolean>>()

    private fun client(fp: String): OkHttpClient {
      val binding = networkBinding()
      val key = fp + ":" + (binding?.identity ?: "default")
      if (clients.size > 4) clients.keys.filter { it != key }.forEach { clients.remove(it)?.connectionPool?.evictAll() }
      return clients.getOrPut(key) {
        val tm = FingerprintTrustManager(fp)
        val ctx = SSLContext.getInstance("TLS").apply { init(null, arrayOf(tm), java.security.SecureRandom()) }
        OkHttpClient.Builder()
            .sslSocketFactory(ctx.socketFactory, tm)
            // Hosts are bare IPs; the pinned fingerprint is what authenticates the PC.
            .hostnameVerifier { _, _ -> true }
            .connectTimeout(3, TimeUnit.SECONDS)
            .readTimeout(10, TimeUnit.SECONDS)
            .writeTimeout(10, TimeUnit.SECONDS)
            .pingInterval(20, TimeUnit.SECONDS)
            .retryOnConnectionFailure(false)
            .followRedirects(false)
            .followSslRedirects(false)
            .apply { binding?.let { b -> socketFactory(b.socketFactory); b.dns?.let { dns(it) } } }
            .build()
      }
    }

    private fun urlFor(route: Route, path: String) = (route.endpoint.baseUrl + path).toHttpUrl()

    private fun targetOf(url: okhttp3.HttpUrl): String =
        url.encodedPath + (url.encodedQuery?.let { "?$it" } ?: "")

    private suspend fun execute(client: OkHttpClient, request: Request): HttpResult = withContext(Dispatchers.IO) {
        try {
            client.newCall(request).execute().use { resp: Response ->
                HttpResult(resp.code, resp.body.string(), resp.header("Retry-After")?.toIntOrNull())
            }
        } catch (e: IOException) {
            throw RemoteException.Network(e)
        }
    }

    override suspend fun ping(route: Route, fingerprint: String, timeoutMs: Int): Boolean {
        val c = client(fingerprint).newBuilder()
            .connectTimeout(timeoutMs.toLong(), TimeUnit.MILLISECONDS)
            .readTimeout(timeoutMs.toLong(), TimeUnit.MILLISECONDS)
            .build()
        return try {
            val r = execute(c, Request.Builder().url(urlFor(route, "/v1/ping")).get().build())
            r.isSuccess && r.json().optBoolean("ok", false)
        } catch (e: Exception) {
            false
        }
    }

    override suspend fun postUnauthenticated(route: Route, fingerprint: String, path: String, body: String): HttpResult {
        val req = Request.Builder().url(urlFor(route, path))
            .post(body.toByteArray(Charsets.UTF_8).toRequestBody(JSON_MEDIA)).build()
        return execute(client(fingerprint), req)
    }

    override suspend fun request(
        route: Route, fingerprint: String, method: String, path: String, body: ByteArray?, signer: RequestSigner
    ): HttpResult {
        val url = urlFor(route, path)
        val bytes = body ?: ByteArray(0)
        val b = Request.Builder().url(url)
        signer.headers(method, targetOf(url), bytes).forEach { (k, v) -> b.header(k, v) }
        if (method.equals("GET", true)) b.get() else b.method(method.uppercase(), bytes.toRequestBody(JSON_MEDIA))
        return execute(client(fingerprint), b.build())
    }

    override fun events(route: Route, fingerprint: String, signer: RequestSigner): Flow<WsEvent> = callbackFlow {
        val url = urlFor(route, "/v1/ws")
        val b = Request.Builder().url(url)
        signer.headers("GET", targetOf(url)).forEach { (k, v) -> b.header(k, v) }
        val ws: WebSocket = client(fingerprint).newWebSocket(b.build(), object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                activeWebSocket = webSocket
                trySend(WsEvent.Open)
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                val o = try { JSONObject(text) } catch (e: Exception) { return }
                when (o.optString("type")) {
                    "hello" -> {
                        val hosts = o.optJSONArray("hosts")
                        trySend(WsEvent.Hello(o.optString("pcName", ""), (0 until (hosts?.length() ?: 0)).map { hosts!!.getString(it) }))
                    }
                    "ack" -> {
                        val id = o.optString("id")
                        val ok = o.optBoolean("ok") && o.optJSONObject("data")?.optBoolean("ok", true) != false
                        val error = o.optString("error").ifEmpty { null }
                        pending.remove(id)?.let { if (ok) it.complete(true) else it.completeExceptionally(RemoteException.NoRoute(error ?: "PC input failed")) }
                        trySend(WsEvent.CommandAck(id, ok, error))
                    }
                    "snapshot", "agents" -> {
                        trySend(WsEvent.Agents(RemoteJson.parseAgents(o)))
                        val approvals = o.optJSONArray("approvals")
                        if (approvals != null) trySend(WsEvent.Approvals((0 until approvals.length()).mapNotNull { approvals.optJSONObject(it) }))
                    }
                    "app" -> trySend(WsEvent.AppUpdate(o.optString("channel"), o.opt("payload")))
                    "event" -> o.optJSONObject("event")?.let { trySend(WsEvent.Activity(it)) }
                    "desktop.error" -> trySend(WsEvent.DesktopError(o.optString("error")))
                }
            }

            override fun onMessage(webSocket: WebSocket, bytes: okio.ByteString) {
                val frame = DesktopFrameCodec.decode(bytes.toByteArray()) ?: return
                if (android.util.Log.isLoggable("SwarmRemote", android.util.Log.DEBUG) && (frame.sequence == 1 || frame.sequence % 120 == 0)) android.util.Log.d("SwarmRemote", "FRAME_RECEIVED FRAME_SIZE=${frame.jpegData.size} FRAME_WIDTH=${frame.width} FRAME_HEIGHT=${frame.height} FRAME_TIMESTAMP=${frame.timestamp}")
                trySend(frame)
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                if (activeWebSocket === webSocket) activeWebSocket = null
                webSocket.close(1000, null)
                trySend(WsEvent.Closed(code))
                close()
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                if (activeWebSocket === webSocket) activeWebSocket = null
                trySend(WsEvent.Closed(code))
                close()
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                if (activeWebSocket === webSocket) activeWebSocket = null
                if (response?.code == 401) trySend(WsEvent.Closed(4401)) else trySend(WsEvent.Failure(t))
                close()
            }
        })
        awaitClose { 
            if (activeWebSocket === ws) activeWebSocket = null
            pending.values.forEach { it.completeExceptionally(RemoteException.NoRoute("PC connection closed.")) }
            pending.clear()
            ws.cancel() 
        }
    }

    override suspend fun sendCommand(cmd: String, args: Map<String, Any?>): Boolean {
        val result = CompletableDeferred<Boolean>()
        val id = sendCommandOrdered(cmd, args, result) ?: throw RemoteException.NoRoute("Desktop WebSocket is not connected yet.")
        return try { withTimeout(10000) { result.await() } } finally { pending.remove(id) }
    }

    @Synchronized private fun sendCommandOrdered(cmd: String, args: Map<String, Any?>, result: CompletableDeferred<Boolean>): String? {
        val ws = activeWebSocket ?: return null
        try {
            val counter = ++commandCounter
            val id = "mobile-$counter"
            pending[id] = result
            val message = JSONObject()
                .put("type", "cmd")
                .put("id", id)
                .put("ctr", counter)
                .put("cmd", cmd)
                .put("args", JSONObject(args))
                .toString()
            if (!ws.send(message)) { pending.remove(id); return null }
            return id
        } catch (e: Exception) {
            return null
        }
    }

    companion object {
        fun encodeSegment(s: String): String = URLEncoder.encode(s, "UTF-8").replace("+", "%20")
    }
}
