package com.swarm.ai.net.connectivity

import android.content.Context
import com.swarm.ai.remote.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import java.net.InetSocketAddress
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocket

data class DiagnosticStep(val layer: String, val status: String, val detail: String)
data class RouteDiagnostic(val endpoint: String, val steps: List<DiagnosticStep>)

/** Tests the complete path from the phone's current network without altering the live connection. */
suspend fun diagnoseConnection(context: Context, record: PairingRecord): List<RouteDiagnostic> = withContext(Dispatchers.IO) {
    val binding = AndroidNetworks.bindToActiveNetwork(context)
    val routes = RouteClassifier.classify(record.hosts)
    routes.map { route ->
        val steps = mutableListOf<DiagnosticStep>()
        val ipv6 = route.endpoint.host.contains(':')
        steps += DiagnosticStep(if (ipv6) "Public IPv6" else "Address", "PASS", route.endpoint.host)
        steps += DiagnosticStep("Port", "PASS", route.endpoint.port.toString())
        var connected = false
        var trusted = false
        try {
            val socket = binding?.socketFactory?.createSocket() ?: java.net.Socket()
            socket.use {
                it.connect(InetSocketAddress(route.endpoint.host, route.endpoint.port), 3000)
                connected = true
                steps += DiagnosticStep("TCP", "PASS", "Connection accepted on this network")
                val trust = FingerprintTrustManager(record.fingerprint)
                val tls = SSLContext.getInstance("TLS").apply { init(null, arrayOf(trust), java.security.SecureRandom()) }
                (tls.socketFactory.createSocket(it, route.endpoint.host, route.endpoint.port, true) as SSLSocket).use { secure ->
                    secure.soTimeout = 3000; secure.startHandshake(); trusted = true
                    steps += DiagnosticStep("TLS", "PASS", "Certificate matches paired PC · ${secure.session.protocol}")
                }
            }
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) {
            steps += DiagnosticStep(if (connected) "TLS" else "TCP", "FAIL", e.message ?: e.javaClass.simpleName)
        }
        if (!connected) steps += DiagnosticStep("TLS", "SKIP", "TCP failed before TLS. A timeout alone cannot distinguish PC, router firewall or ISP filtering.")
        if (trusted) {
            val transport = OkHttpTransport { binding }
            val signer = RequestSigner(record.deviceId, record.deviceSecret, DeviceKey(record.deviceId).signer())
            try {
                val status = transport.request(route, record.fingerprint, "GET", "/v1/status", null, signer)
                if (!status.isSuccess) error("HTTP ${status.code}: ${status.json().optString("error")}")
                steps += DiagnosticStep("Authentication", "PASS", "Paired device signature accepted")
                withTimeout(6000) { transport.events(route, record.fingerprint, signer).first { it is WsEvent.Hello || it is WsEvent.Failure || it is WsEvent.Closed }.let { if (it !is WsEvent.Hello) error(it.toString()) } }
                steps += DiagnosticStep("WebSocket", "PASS", "Authenticated hello received")
                steps += DiagnosticStep("SWARM", "PASS", "${status.json().optString("pcName")} responded")
                val diagnostic = transport.request(route, record.fingerprint, "GET", "/v1/diagnostics", null, signer)
                if (diagnostic.isSuccess) {
                    val j = diagnostic.json()
                    val listener = j.optJSONObject("listener")
                    steps += DiagnosticStep("PC IPv6 listener", if (listener?.optString("address") == "::") "PASS" else "FAIL", listener?.toString() ?: "Listener details unavailable")
                    val firewall = j.optString("firewall", "unknown")
                    steps += DiagnosticStep("PC firewall", when (firewall) { "allowed" -> "PASS"; "missing" -> "FAIL"; else -> "UNKNOWN" }, firewall)
                }
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) {
                val layer = if (steps.none { it.layer == "Authentication" }) "Authentication" else "WebSocket"
                steps += DiagnosticStep(layer, "FAIL", e.message ?: "Request failed")
            }
        }
        listOf("Authentication", "WebSocket", "SWARM").forEach { layer -> if (steps.none { it.layer == layer }) steps += DiagnosticStep(layer, "SKIP", "An earlier layer failed") }
        if (ipv6) steps += DiagnosticStep("Router / ISP", if (steps.any { it.layer == "TCP" && it.status == "PASS" }) "PASS" else "UNKNOWN", if (connected) "TCP reached the PC from the phone's current network; use mobile data to verify internet ingress." else "No TCP response. Check router inbound IPv6 rules and ISP reachability after confirming the PC listener and firewall.")
        RouteDiagnostic(route.endpoint.display, steps)
    }
}
