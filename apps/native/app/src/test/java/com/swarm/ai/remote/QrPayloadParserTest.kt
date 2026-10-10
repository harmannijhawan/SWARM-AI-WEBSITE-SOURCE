package com.swarm.ai.remote

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class QrPayloadParserTest {
    private val fp = "a".repeat(64)

    private fun json(
        v: String = "1",
        hosts: String = "[\"192.168.1.20:47821\",\"[2401:db8::5]:47821\",\"203.0.113.7:47821\"]",
        fingerprint: String = fp,
        tok: String = "dG9rZW4",
        name: String = "Harman-i5"
    ) = """{"v":$v,"hosts":$hosts,"fp":"$fingerprint","tok":"$tok","name":"$name"}"""

    @Test
    fun parsesValidPayload() {
        val p = QrPayloadParser.parse(json())
        assertEquals(1, p.version)
        assertEquals(listOf("192.168.1.20:47821", "[2401:db8::5]:47821", "203.0.113.7:47821"), p.hosts)
        assertEquals(fp, p.fingerprint)
        assertEquals("dG9rZW4", p.token)
        assertEquals("Harman-i5", p.pcName)
    }

    @Test
    fun toleratesWhitespaceAndNormalizesFingerprint() {
        val colon = "AB".repeat(32).chunked(2).joinToString(":")
        val p = QrPayloadParser.parse("  \n" + json(fingerprint = colon) + "\n ")
        assertEquals("ab".repeat(32), p.fingerprint)
    }

    @Test
    fun dropsInvalidAndPlaintextHostsButKeepsOrder() {
        val p = QrPayloadParser.parse(
            json(hosts = "[\"http://10.0.0.1:1\",\"bad host\",\"10.0.0.2:47821\",\"10.0.0.2:47821\",\"https://pc.example.org\"]")
        )
        assertEquals(listOf("10.0.0.2:47821", "https://pc.example.org"), p.hosts)
    }

    @Test
    fun defaultsNameWhenMissing() {
        val p = QrPayloadParser.parse("""{"v":1,"hosts":["10.0.0.2:1"],"fp":"$fp","tok":"x"}""")
        assertEquals("PC", p.pcName)
    }

    @Test
    fun rejectsGarbage() {
        assertFailsWith<QrParseException> { QrPayloadParser.parse("") }
        assertFailsWith<QrParseException> { QrPayloadParser.parse("hello world") }
        assertFailsWith<QrParseException> { QrPayloadParser.parse("https://example.com/not-a-payload") }
    }

    @Test
    fun rejectsWrongVersion() {
        assertFailsWith<QrParseException> { QrPayloadParser.parse(json(v = "2")) }
        assertFailsWith<QrParseException> { QrPayloadParser.parse("""{"hosts":["10.0.0.2:1"],"fp":"$fp","tok":"x"}""") }
    }

    @Test
    fun rejectsMissingOrEmptyHosts() {
        assertFailsWith<QrParseException> { QrPayloadParser.parse("""{"v":1,"fp":"$fp","tok":"x"}""") }
        assertFailsWith<QrParseException> { QrPayloadParser.parse(json(hosts = "[]")) }
        assertFailsWith<QrParseException> { QrPayloadParser.parse(json(hosts = "[\"http://10.0.0.1:1\"]")) }
    }

    @Test
    fun rejectsBadFingerprintOrToken() {
        assertFailsWith<QrParseException> { QrPayloadParser.parse(json(fingerprint = "abc")) }
        assertFailsWith<QrParseException> { QrPayloadParser.parse(json(fingerprint = "z".repeat(64))) }
        assertFailsWith<QrParseException> { QrPayloadParser.parse(json(tok = "")) }
    }
}