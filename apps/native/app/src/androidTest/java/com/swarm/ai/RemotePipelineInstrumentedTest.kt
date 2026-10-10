package com.swarm.ai

import android.graphics.BitmapFactory
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.swarm.ai.remote.*
import com.swarm.ai.net.connectivity.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.json.JSONObject
import java.net.InetSocketAddress
import java.net.Socket
import java.io.File

/** Runs on the actual paired phone. Never prints or exports device secrets/keys. */
@RunWith(AndroidJUnit4::class)
class RemotePipelineInstrumentedTest {
    @get:Rule val compose = createComposeRule()

    @Test fun storedPairingDesktop() = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val transport = OkHttpTransport()
        val client = RemoteClient(PairingStore(context), transport, RaceRouteConnector())
        val arguments = InstrumentationRegistry.getArguments()
        val qr = arguments.getString("pairing") ?: arguments.getString("pairingBase64")?.let { String(android.util.Base64.decode(it, android.util.Base64.DEFAULT), Charsets.UTF_8) }
        if (qr != null) client.pair(qr)
        assertTrue("Existing pairing required", client.isPaired)
        val vm = com.swarm.ai.ui.screens.RemotePCViewModel(client)
        val route = client.ensureRoute()
        client.listAgents() // real signed authentication
        compose.setContent {
            com.swarm.ai.ui.screens.RemotePCPage(com.swarm.ai.ui.companion.CompanionState(),
                com.swarm.ai.remote.ui.RemoteUiState(paired = true, pcName = client.pairing.value!!.pcName), true, vm)
        }
        compose.waitUntil(15000) { vm.streamState.value.frame != null }
        assertTrue(vm.streamState.value.isStreaming)
        compose.onNodeWithContentDescription("Real PC desktop").assertExists()
        val state = vm.streamState.value
        val report = JSONObject().put("route", route.endpoint.display).put("width", state.frameWidth)
            .put("height", state.frameHeight).put("sequence", state.sequence).put("rendered", true)
        File(context.getExternalFilesDir(null), "remote-pipeline.json").writeText(report.toString(2))
        vm.stopStream()
    }

    @Test fun publicIPv6Stages(): Unit = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val record = PairingStore(context).load() ?: error("Existing pairing required")
        val forced = InstrumentationRegistry.getArguments().getString("endpoint")
        val route = RouteClassifier.classify(if (forced != null) listOf(forced) else record.hosts)
            .first { it.endpoint.host.contains(':') && !HostParsing.isPrivateIpv6(it.endpoint.host) }
        val report = JSONObject().put("address", route.endpoint.display).put("DNS/address", "OK")
        var stage = "TCP"
        try {
            withContext(Dispatchers.IO) {
                Socket().use { it.connect(InetSocketAddress(route.endpoint.host, route.endpoint.port), 4000) }
            }
            report.put(stage, "OK")
            stage = "TLS/health"
            PinnedPingProbe().ping(route.endpoint.baseUrl, record.fingerprint, 4000)
            report.put(stage, "OK")
            stage = "Authentication"
            val signer = RequestSigner(record.deviceId, record.deviceSecret, DeviceKey(record.deviceId).signer())
            val transport = OkHttpTransport()
            val auth = transport.request(route, record.fingerprint, "GET", "/v1/status", null, signer)
            check(auth.isSuccess) { "HTTP ${auth.code}" }
            report.put(stage, "OK")
            stage = "WebSocket/frame"
            val frame = withTimeout(12000) {
                transport.events(route, record.fingerprint, signer).first {
                    if (it is WsEvent.Open) transport.sendCommand("desktop.start", mapOf("maxWidth" to 1280, "maxHeight" to 720))
                    if (it is WsEvent.Failure) throw it.error
                    it is WsEvent.DesktopFrame
                } as WsEvent.DesktopFrame
            }
            check(withContext(Dispatchers.Default) { BitmapFactory.decodeByteArray(frame.jpegData, 0, frame.jpegData.size) } != null)
            report.put(stage, "OK").put("SWARM", "OK")
        } catch (error: Throwable) {
            report.put(stage, "FAIL").put("reason", error.message)
            throw error
        } finally {
            File(context.getExternalFilesDir(null), "public-ipv6-stages.json").writeText(report.toString(2))
            android.util.Log.i("SwarmRemoteTest", report.toString())
        }
    }
}
