package com.swarm.ai.remote

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class RoutesTest {
    @Test
    fun parsesIpv4WithPort() {
        val e = assertNotNull(HostEndpoint.parseOrNull("192.168.1.20:47821"))
        assertEquals("https://192.168.1.20:47821", e.baseUrl)
        assertEquals(47821, e.port)
    }

    @Test
    fun parsesBracketedIpv6() {
        val e = assertNotNull(HostEndpoint.parseOrNull("[2401:db8::5]:50000"))
        assertEquals("2401:db8::5", e.host)
        assertEquals(50000, e.port)
        assertEquals("https://[2401:db8::5]:50000", e.baseUrl)
        assertEquals("[2401:db8::5]:50000", e.display)
    }

    @Test
    fun usesDefaultPortAndHandlesBareIpv6() {
        assertEquals(47821, assertNotNull(HostEndpoint.parseOrNull("10.0.0.5")).port)
        val v6 = assertNotNull(HostEndpoint.parseOrNull("2401:db8::5"))
        assertEquals("https://[2401:db8::5]:47821", v6.baseUrl)
    }

    @Test
    fun parsesHttpsUrlAndRejectsPlaintext() {
        val e = assertNotNull(HostEndpoint.parseOrNull("https://pc.example.org/x/"))
        assertEquals("https://pc.example.org/x", e.baseUrl)
        assertTrue(e.isUrl)
        assertNull(HostEndpoint.parseOrNull("http://pc.example.org"))
    }

    @Test
    fun rejectsMalformed() {
        assertNull(HostEndpoint.parseOrNull(""))
        assertNull(HostEndpoint.parseOrNull("host:notaport"))
        assertNull(HostEndpoint.parseOrNull("host:70000"))
        assertNull(HostEndpoint.parseOrNull("a b:1"))
        assertNull(HostEndpoint.parseOrNull("[::1"))
        assertNull(HostEndpoint.parseOrNull("host/path"))
    }

    @Test
    fun classifiesRoutesInQrOrderWithNeutralLabels() {
        val routes = RouteClassifier.classify(
            listOf(
                "192.168.1.20:47821", "10.8.0.2:47821", "[2401:db8::5]:47821",
                "203.0.113.7:51000", "198.51.100.9:47821", "pc.example.org:47821"
            )
        )
        assertEquals(
            listOf(
                RouteKind.HOME_NETWORK, RouteKind.HOME_NETWORK, RouteKind.PUBLIC_IPV6,
                RouteKind.MAPPED_PORT, RouteKind.MANUAL, RouteKind.MANUAL
            ),
            routes.map { it.kind }
        )
        assertEquals(listOf("Home network", "Public IPv6", "Mapped port", "Manual"), RouteKind.values().map { it.label })
    }

    @Test
    fun privateRangesDetected() {
        assertTrue(HostEndpoint.isPrivateIpv4("172.16.0.1"))
        assertTrue(HostEndpoint.isPrivateIpv4("172.31.255.1"))
        assertTrue(!HostEndpoint.isPrivateIpv4("172.32.0.1"))
        assertTrue(!HostEndpoint.isPrivateIpv4("8.8.8.8"))
    }
}