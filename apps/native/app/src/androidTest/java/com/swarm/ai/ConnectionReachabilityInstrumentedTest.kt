package com.swarm.ai

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.swarm.ai.net.connectivity.AndroidNetworks
import com.swarm.ai.net.connectivity.PinnedPingProbe
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.net.InetSocketAddress
import javax.net.SocketFactory

/** Uses the app's own UID and pinned transport on the connected phone; no stored identity is changed. */
@RunWith(AndroidJUnit4::class)
class ConnectionReachabilityInstrumentedTest {
    @Test fun desktopTcpAndPinnedTls() = runBlocking {
        val args = InstrumentationRegistry.getArguments()
        val host = args.getString("host") ?: "192.168.29.158"
        val port = args.getString("port")?.toInt() ?: 47821
        val fp = args.getString("fingerprint") ?: error("Expected the PC's public certificate fingerprint")
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val binding = AndroidNetworks.bindToActiveNetwork(context)
        var working = false
        for ((name, network) in listOf("active network" to binding, "default network" to null)) {
            var stage = "TCP"
            try {
                (network?.socketFactory ?: SocketFactory.getDefault()).createSocket().use {
                    it.connect(InetSocketAddress(host, port), 4000)
                }
                android.util.Log.i("SwarmConnectionTest", "$name TCP PASS")
                stage = "Pinned TLS and SWARM ping"
                PinnedPingProbe(network).ping("https://${if (host.contains(':')) "[$host]" else host}:$port", fp, 5000)
                android.util.Log.i("SwarmConnectionTest", "$name $stage PASS")
                working = true
            } catch (error: Throwable) {
                android.util.Log.e("SwarmConnectionTest", "$name $stage FAIL: ${error.javaClass.simpleName}: ${error.message}")
            }
        }
        assertTrue("No pinned TLS path answered; see SwarmConnectionTest for the exact failing layer", working)
    }
}
