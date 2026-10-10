package com.swarm.ai.net.connectivity

import com.swarm.ai.remote.QrPayload
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.currentTime
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.ConnectException
import java.net.UnknownHostException

@OptIn(ExperimentalCoroutinesApi::class)
class ConnectBestTest {
    private val fp = "ab".repeat(32)

    /** Fake network: map of baseUrl -> (delayMs, failure or null). Unknown baseUrls hang until timeout. */
    private class FakeProbe(val scope: TestScope, val plan: Map<String, Pair<Long, Throwable?>>) : PingProbe {
        val started = mutableListOf<Pair<String, Long>>()
        val cancelled = mutableListOf<String>()
        override suspend fun ping(baseUrl: String, fingerprint: String, timeoutMs: Long): PingInfo {
            started.add(baseUrl to scope.currentTime)
            try {
                val p = plan[baseUrl]
                if (p == null) { delay(10 * timeoutMs); error("unreachable") }
                delay(p.first)
                p.second?.let { throw it }
                return PingInfo(1)
            } catch (e: CancellationException) {
                cancelled.add(baseUrl); throw e
            }
        }
    }

    private fun TestScope.opts(probe: PingProbe, memory: EndpointMemory? = null, last: String? = null, v6: Boolean = true) =
        ConnectOptions(lastKnownGood = last, memory = memory, probe = probe, ipv6Available = v6, clockMs = { currentTime })

    @Test fun lanWinsAndOthersAreCancelled() = runTest {
        val probe = FakeProbe(this, mapOf(
            "https://192.168.1.20:47821" to (40L to null),
            "https://[2401:db8::5]:47821" to (10L to null)
        ))
        val r = connectBest(SimpleConnectTarget(listOf("203.0.113.7:47821", "[2401:db8::5]:47821", "192.168.1.20:47821"), fp), opts(probe))
        assertEquals("192.168.1.20:47821", r.endpoint!!.raw)
        assertEquals("https://192.168.1.20:47821", r.endpoint!!.baseUrl)
        assertEquals(40L, r.endpoint!!.latencyMs)
        assertEquals(AttemptStatus.SUCCESS, r.diagnostics.first { it.raw == "192.168.1.20:47821" }.status)
        // IPv6 was started at 250 ms, but the LAN probe finished at 40 ms: it never started.
        assertEquals(AttemptStatus.SKIPPED, r.diagnostics.first { it.raw == "[2401:db8::5]:47821" }.status)
        assertEquals(AttemptStatus.SKIPPED, r.diagnostics.first { it.raw == "203.0.113.7:47821" }.status)
        assertEquals(1, probe.started.size)
    }

    @Test fun staggerStartsLaterCandidatesAndSlowLanLoses() = runTest {
        val probe = FakeProbe(this, mapOf(
            "https://192.168.1.20:47821" to (5000L to null),
            "https://[2401:db8::5]:47821" to (100L to null)
        ))
        val r = connectBest(SimpleConnectTarget(listOf("192.168.1.20:47821", "[2401:db8::5]:47821"), fp), opts(probe))
        assertEquals("[2401:db8::5]:47821", r.endpoint!!.raw)
        assertEquals(listOf("https://192.168.1.20:47821" to 0L, "https://[2401:db8::5]:47821" to 250L), probe.started)
        assertEquals(AttemptStatus.CANCELLED, r.diagnostics.first { it.raw == "192.168.1.20:47821" }.status)
        assertEquals(350L, r.totalMs)
        assertTrue(probe.cancelled.contains("https://192.168.1.20:47821"))
    }

    @Test fun failureStartsNextCandidateImmediately() = runTest {
        val probe = FakeProbe(this, mapOf(
            "https://192.168.1.20:47821" to (20L to ConnectException("Connection refused")),
            "https://203.0.113.7:47821" to (30L to null)
        ))
        val r = connectBest(SimpleConnectTarget(listOf("192.168.1.20:47821", "203.0.113.7:47821"), fp), opts(probe))
        assertEquals("203.0.113.7:47821", r.endpoint!!.raw)
        assertEquals(20L, probe.started[1].second)
        val failed = r.diagnostics.first { it.raw == "192.168.1.20:47821" }
        assertEquals(AttemptStatus.FAILED, failed.status); assertEquals(ProbeErrorKind.CONNECTION_REFUSED, failed.errorKind)
        assertEquals(50L, r.totalMs)
    }

    @Test fun allFailGivesDiagnosticsNoEndpoint() = runTest {
        val probe = FakeProbe(this, mapOf(
            "https://192.168.1.20:47821" to (0L to ConnectException("Network is unreachable")),
            "https://[2401:db8::5]:47821" to (0L to ConnectException("Network is unreachable")),
            "https://pc.example.com" to (0L to UnknownHostException("pc.example.com"))
        ))
        val r = connectBest(
            SimpleConnectTarget(listOf("192.168.1.20:47821", "[2401:db8::5]:47821", "https://pc.example.com", "rtc:abc", "bad host"), fp),
            opts(probe)
        )
        assertNull(r.endpoint); assertFalse(r.isSuccess)
        assertEquals(5, r.diagnostics.size)
        assertEquals(AttemptStatus.UNSUPPORTED, r.diagnostics.first { it.raw == "rtc:abc" }.status)
        assertEquals(AttemptStatus.INVALID, r.diagnostics.first { it.raw == "bad host" }.status)
        assertEquals("No network connection.", r.failureHint())
        assertTrue(r.summary().contains("No route reachable"))
    }

    @Test fun hangingCandidateTimesOutAtConnectTimeout() = runTest {
        val probe = FakeProbe(this, emptyMap())
        val r = connectBest(SimpleConnectTarget(listOf("192.168.1.20:47821"), fp), opts(probe))
        assertNull(r.endpoint)
        val d = r.diagnostics.single()
        assertEquals(AttemptStatus.FAILED, d.status); assertEquals(ProbeErrorKind.TIMEOUT, d.errorKind)
        assertEquals(3000L, r.totalMs)
    }

    @Test fun lastKnownGoodIsTriedFirstAndRemembered() = runTest {
        val mem = InMemoryEndpointMemory()
        mem.put(fp, "203.0.113.7:47821")
        val probe = FakeProbe(this, mapOf("https://203.0.113.7:47821" to (30L to null), "https://192.168.1.20:47821" to (10L to null)))
        val r = connectBest(SimpleConnectTarget(listOf("192.168.1.20:47821", "203.0.113.7:47821"), fp), opts(probe, memory = mem))
        assertEquals("203.0.113.7:47821", r.endpoint!!.raw)
        assertEquals("https://203.0.113.7:47821", probe.started.first().first)
        assertEquals("203.0.113.7:47821", mem.get(fp))

        // LAN becomes the only reachable one -> memory is updated to it.
        val probe2 = FakeProbe(this, mapOf("https://192.168.1.20:47821" to (10L to null)))
        val r2 = connectBest(SimpleConnectTarget(listOf("192.168.1.20:47821", "203.0.113.7:47821"), fp), opts(probe2, memory = mem))
        assertEquals("192.168.1.20:47821", r2.endpoint!!.raw)
        assertEquals("192.168.1.20:47821", mem.get(fp))
    }

    @Test fun transportFactoryExtensionPoint() = runTest {
        val factory = object : TransportFactory {
            override fun supports(scheme: String) = scheme == "rtc"
            override fun create(entry: String, scheme: String, fingerprint: String) = object : ConnectAttempt {
                override val id = entry
                override val label = "Tunnel"
                override suspend fun run(timeoutMs: Long): AttemptSuccess { delay(5); return AttemptSuccess("127.0.0.1", 9999, "https://127.0.0.1:9999") }
            }
        }
        val probe = FakeProbe(this, emptyMap())
        val r = connectBest(
            SimpleConnectTarget(listOf("203.0.113.7:47821", "rtc:abc"), fp),
            opts(probe).copy(transportFactories = listOf(factory), connectTimeoutMs = 2000)
        )
        assertEquals("rtc:abc", r.endpoint!!.raw)
        assertEquals("https://127.0.0.1:9999", r.endpoint!!.baseUrl)
    }

    @Test fun qrPayloadAdapter() = runTest {
        val probe = FakeProbe(this, mapOf("https://192.168.1.20:47821" to (1L to null)))
        val qr = QrPayload(1, listOf("192.168.1.20:47821"), fp, "tok", "PC")
        assertNotNull(connectBest(qr, opts(probe)).endpoint)
    }

    @Test fun badFingerprintIsRejected() = runTest {
        val probe = FakeProbe(this, emptyMap())
        try {
            connectBest(SimpleConnectTarget(listOf("192.168.1.20:47821"), "zz"), opts(probe))
            error("expected IllegalArgumentException")
        } catch (e: IllegalArgumentException) {
        }
    }

    @Test fun wifiCellularWifiSwitchUsesStoredEndpointsWithoutPairingAgain() = runTest {
        val hosts = listOf("192.168.1.20:47821", "[2401:db8::5]:47821")
        val lan = "https://192.168.1.20:47821"
        val wan = "https://[2401:db8::5]:47821"
        val wifi = FakeProbe(this, mapOf(lan to (10L to null), wan to (10L to null)))
        assertEquals(hosts[0], connectBest(SimpleConnectTarget(hosts, fp), opts(wifi)).endpoint!!.raw)
        val cellular = FakeProbe(this, mapOf(lan to (3000L to ConnectException("Network is unreachable")), wan to (10L to null)))
        assertEquals(hosts[1], connectBest(SimpleConnectTarget(hosts, fp), opts(cellular).copy(preferLocal = false)).endpoint!!.raw)
        assertEquals(wan, cellular.started.first().first)
        val restored = FakeProbe(this, mapOf(lan to (10L to null), wan to (10L to null)))
        assertEquals(hosts[0], connectBest(SimpleConnectTarget(hosts, fp), opts(restored)).endpoint!!.raw)
        assertEquals(lan, restored.started.first().first)
    }

    @Test fun publicIpv6TimeoutNamesTheLayerBeforeTls() = runTest {
        val probe = FakeProbe(this, emptyMap())
        val result = connectBest(SimpleConnectTarget(listOf("[2401:db8::5]:47821"), fp), opts(probe).copy(preferLocal = false))
        assertTrue(result.failureHint().contains("before TLS"))
        assertTrue(result.failureHint().contains("router IPv6 firewalls"))
    }

    @Test fun emptyHostsGivesEmptyResult() = runTest {
        val r = connectBest(SimpleConnectTarget(emptyList(), fp), opts(FakeProbe(this, emptyMap())))
        assertNull(r.endpoint); assertTrue(r.diagnostics.isEmpty())
    }

    @Test fun refreshHostsMergesAndIsNoopWithoutField() = runTest {
        val cur = listOf("192.168.1.20:47821")
        val same = refreshHosts(cur) { """{"v":1}""" }
        assertFalse(same.changed); assertEquals(cur, same.hosts)
        val failed = refreshHosts(cur) { throw RuntimeException("net") }
        assertFalse(failed.changed)
        val upd = refreshHosts(cur) { """{"hosts":["192.168.1.77:47821","192.168.1.20:47821"]}""" }
        assertTrue(upd.changed)
        assertEquals(listOf("192.168.1.77:47821", "192.168.1.20:47821"), upd.hosts)
        assertEquals(listOf("192.168.1.77:47821"), upd.added)
    }
}
