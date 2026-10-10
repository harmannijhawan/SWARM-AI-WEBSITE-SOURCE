package com.swarm.ai.net.connectivity

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HostParsingTest {
    private fun direct(s: String): Candidate = (HostParsing.parseEntry(s) as ParsedEntry.Direct).candidate

    @Test fun ipv4WithPort() {
        val c = direct("192.168.1.20:47821")
        assertEquals("192.168.1.20", c.host); assertEquals(47821, c.port)
        assertEquals("https://192.168.1.20:47821", c.baseUrl)
        assertEquals(AddressKind.LAN_IPV4, c.kind)
        assertFalse(c.isIpv6)
    }

    @Test fun ipv4DefaultPort() {
        assertEquals(DEFAULT_BARE_PORT, direct("10.0.0.5").port)
    }

    @Test fun bracketedIpv6() {
        val c = direct("[2401:db8::5]:47821")
        assertEquals("2401:db8::5", c.host); assertEquals(47821, c.port)
        assertEquals("https://[2401:db8::5]:47821", c.baseUrl)
        assertEquals(AddressKind.GLOBAL_IPV6, c.kind)
        assertEquals("[2401:db8::5]:47821", c.display)
    }

    @Test fun bracketedIpv6DefaultPortAndBareLiteral() {
        assertEquals(DEFAULT_BARE_PORT, direct("[2401:db8::5]").port)
        val bare = direct("2401:db8::5")
        assertEquals("2401:db8::5", bare.host); assertEquals(DEFAULT_BARE_PORT, bare.port)
        assertEquals("https://[2401:db8::5]:47821", bare.baseUrl)
    }

    @Test fun bareLiteralStartingWithLettersIsNotAScheme() {
        val c = direct("fe80::1")
        assertEquals(AddressKind.LAN_IPV6, c.kind)
        assertEquals("fd12:3456::1", direct("[fd12:3456::1]:1234").host)
        assertEquals(AddressKind.LAN_IPV6, direct("[fd12:3456::1]:1234").kind)
    }

    @Test fun hostnameWithPortIsNotAScheme() {
        val c = direct("pc.example.com:47821")
        assertEquals("pc.example.com", c.host); assertEquals(AddressKind.HOSTNAME, c.kind)
        assertEquals(AddressKind.LAN_HOSTNAME, direct("harman-pc.local:47821").kind)
    }

    @Test fun httpsUrls() {
        val a = direct("https://pc.example.com")
        assertEquals(443, a.port); assertEquals("https://pc.example.com", a.baseUrl); assertTrue(a.isUrl)
        assertEquals(AddressKind.URL, a.kind)
        val b = direct("https://pc.example.com:8443/bridge/")
        assertEquals(8443, b.port); assertEquals("https://pc.example.com:8443/bridge", b.baseUrl)
        val c = direct("https://[2001:db8::1]:9000")
        assertEquals("https://[2001:db8::1]:9000", c.baseUrl); assertEquals("2001:db8::1", c.host)
        assertEquals(AddressKind.LAN_IPV4, direct("https://192.168.0.2:4000").kind)
    }

    @Test fun plaintextHttpRejected() {
        assertTrue(HostParsing.parseEntry("http://192.168.1.2:80") is ParsedEntry.Invalid)
    }

    @Test fun unknownSchemesAreUnsupportedNotInvalid() {
        val r = HostParsing.parseEntry("rtc:abc123") as ParsedEntry.Unsupported
        assertEquals("rtc", r.scheme)
        assertEquals("wg", (HostParsing.parseEntry("wg://x.example.com:51820") as ParsedEntry.Unsupported).scheme)
    }

    @Test fun invalidEntries() {
        listOf("", "  ", "host:0", "host:70000", "host:abc:12", "a b:1", "[::1", "[]:1", "[::1]x", "host/path", "https://", "bad_host!:1", "1.2.3.4:").forEach {
            val e = HostParsing.parseEntry(it)
            assertTrue("'$it' should not be direct: $e", e !is ParsedEntry.Direct)
        }
    }

    @Test fun parseHostsDedupesAndSplits() {
        val r = HostParsing.parseHosts(listOf("192.168.1.2:47821", "192.168.1.2:47821", "[2401:db8::5]:47821", "rtc:zz", "http://x", "rtc:zz"))
        assertEquals(2, r.candidates.size)
        assertEquals(1, r.unsupported.size)
        assertEquals(1, r.invalid.size)
    }

    @Test fun privateRanges() {
        listOf("10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.0.1", "169.254.1.1", "100.64.0.1", "127.0.0.1").forEach {
            assertTrue(it, HostParsing.isPrivateIpv4(it))
        }
        listOf("172.32.0.1", "8.8.8.8", "203.0.113.7", "100.128.0.1", "300.1.1.1").forEach {
            assertFalse(it, HostParsing.isPrivateIpv4(it))
        }
        assertTrue(HostParsing.isPrivateIpv6("fe80::1")); assertTrue(HostParsing.isPrivateIpv6("fdab::1"))
        assertTrue(HostParsing.isPrivateIpv6("::1")); assertTrue(HostParsing.isPrivateIpv6("::ffff:192.168.1.1"))
        assertFalse(HostParsing.isPrivateIpv6("2401:db8::1")); assertFalse(HostParsing.isPrivateIpv6("2fc0::1"))
    }

    @Test fun orderingLanThenIpv6ThenRest() {
        val hosts = listOf("203.0.113.7:47821", "[2401:db8::5]:47821", "https://pc.example.com", "192.168.1.20:47821", "10.0.0.2:1", "[fd00::2]:47821")
        val ordered = HostParsing.order(HostParsing.parseHosts(hosts).candidates).map { it.raw }
        assertEquals(
            listOf("192.168.1.20:47821", "10.0.0.2:1", "[fd00::2]:47821", "[2401:db8::5]:47821", "203.0.113.7:47821", "https://pc.example.com"),
            ordered
        )
    }

    @Test fun orderingDemotesIpv6WithoutIpv6() {
        val hosts = listOf("[2401:db8::5]:47821", "203.0.113.7:47821", "192.168.1.20:47821")
        val ordered = HostParsing.order(HostParsing.parseHosts(hosts).candidates, ipv6Available = false).map { it.raw }
        assertEquals(listOf("192.168.1.20:47821", "203.0.113.7:47821", "[2401:db8::5]:47821"), ordered)
    }

    @Test fun lastGoodGoesFirst() {
        val hosts = listOf("192.168.1.20:47821", "[2401:db8::5]:47821", "203.0.113.7:47821")
        val ordered = HostParsing.order(HostParsing.parseHosts(hosts).candidates, lastGood = "203.0.113.7:47821").map { it.raw }
        assertEquals(listOf("203.0.113.7:47821", "192.168.1.20:47821", "[2401:db8::5]:47821"), ordered)
    }

    @Test fun lastGoodMissingFromListIsAddedUnlessDisabled() {
        val c = HostParsing.parseHosts(listOf("192.168.1.20:47821")).candidates
        assertEquals("8.8.8.8:1", HostParsing.order(c, "8.8.8.8:1").first().raw)
        assertEquals(1, HostParsing.order(c, "8.8.8.8:1", includeLastGoodIfMissing = false).size)
        assertEquals(1, HostParsing.order(c, "garbage!!").size)
    }

    @Test fun lastGoodMatchesDifferentSpelling() {
        val c = HostParsing.parseHosts(listOf("192.168.1.20:47821", "PC.Example.com:47821")).candidates
        assertEquals("PC.Example.com:47821", HostParsing.order(c, "pc.example.com:47821").first().raw)
    }

    @Test fun mergeHosts() {
        val merged = HostParsing.mergeHosts(
            current = listOf("192.168.1.20:47821", "pc.example.com:47821"),
            reported = listOf("192.168.1.99:47821", "192.168.1.20:47821", "junk!!", "rtc:xyz")
        )
        assertEquals(listOf("192.168.1.99:47821", "192.168.1.20:47821", "rtc:xyz", "pc.example.com:47821"), merged)
        val noStale = HostParsing.mergeHosts(listOf("1.1.1.1:1"), listOf("2.2.2.2:2"), keepStale = false)
        assertEquals(listOf("2.2.2.2:2"), noStale)
        assertEquals(listOf("1.1.1.1:1"), HostParsing.mergeHosts(listOf("1.1.1.1:1"), emptyList(), keepStale = false))
        assertEquals(3, HostParsing.mergeHosts(emptyList(), (1..40).map { "10.0.0.$it:1" }, max = 3).size)
    }

    @Test fun parseStatusHosts() {
        val json = """{"v":1,"pcName":"X","hosts":["192.168.1.2:47821", "[2401:db8::5]:47821"],"agentCount":3}"""
        assertEquals(listOf("192.168.1.2:47821", "[2401:db8::5]:47821"), HostParsing.parseStatusHosts(json))
        assertEquals(emptyList<String>(), HostParsing.parseStatusHosts("""{"v":1,"agentCount":3}"""))
        assertEquals(emptyList<String>(), HostParsing.parseStatusHosts("""{"hosts":[]}"""))
    }
}
