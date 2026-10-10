package com.swarm.ai.net.connectivity

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.IOException
import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.SocketException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.security.cert.CertificateException
import javax.net.ssl.SSLHandshakeException

class ProbeErrorsTest {
    @Test fun classification() {
        assertEquals(ProbeErrorKind.UNKNOWN_HOST, ProbeErrors.classify(UnknownHostException("x")))
        assertEquals(ProbeErrorKind.TIMEOUT, ProbeErrors.classify(SocketTimeoutException("timeout")))
        assertEquals(ProbeErrorKind.TIMEOUT, ProbeErrors.classify(ConnectException("failed to connect to /1.2.3.4 (port 1) after 3000ms")))
        assertEquals(ProbeErrorKind.NETWORK_UNREACHABLE, ProbeErrors.classify(ConnectException("Network is unreachable")))
        assertEquals(ProbeErrorKind.NETWORK_UNREACHABLE, ProbeErrors.classify(SocketException("socket failed: EAFNOSUPPORT (Address family not supported by protocol)")))
        assertEquals(ProbeErrorKind.NETWORK_UNREACHABLE, ProbeErrors.classify(NoRouteToHostException("x")))
        assertEquals(ProbeErrorKind.NETWORK_UNREACHABLE, ProbeErrors.classify(IOException("wrapper", ConnectException("connect failed: ENETUNREACH (Network is unreachable)"))))
        assertEquals(ProbeErrorKind.CONNECTION_REFUSED, ProbeErrors.classify(ConnectException("Connection refused")))
        assertEquals(ProbeErrorKind.CERT_MISMATCH, ProbeErrors.classify(SSLHandshakeException("bad").initCause(CertificateException("Certificate fingerprint mismatch"))))
        assertEquals(ProbeErrorKind.TLS, ProbeErrors.classify(SSLHandshakeException("handshake")))
        assertEquals(ProbeErrorKind.INVALID_ADDRESS, ProbeErrors.classify(IllegalArgumentException("bad url")))
        assertEquals(ProbeErrorKind.HTTP_STATUS, ProbeErrors.classify(ConnectAttemptException(ProbeErrorKind.HTTP_STATUS, "HTTP 500")))
        assertEquals(ProbeErrorKind.OTHER, ProbeErrors.classify(RuntimeException("?")))
    }

    @Test fun causeChainTerminatesOnCycles() {
        val a = RuntimeException("a"); val b = RuntimeException("b", a)
        a.initCause(b)
        assertEquals(2, ProbeErrors.causeChain(b).size)
    }

    @Test fun pingBodyParsing() {
        assertEquals(1, PinnedPingProbe.parsePingBody("""{"ok":true,"v":1}""")!!.protocolVersion)
        assertNotNull(PinnedPingProbe.parsePingBody("""{ "ok" : true }"""))
        assertNull(PinnedPingProbe.parsePingBody("""{"ok":false,"v":1}"""))
        assertNull(PinnedPingProbe.parsePingBody("<html>router login</html>"))
    }
}
