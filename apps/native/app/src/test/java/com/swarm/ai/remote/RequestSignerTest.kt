package com.swarm.ai.remote

import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import org.mockito.Mockito.mock
import org.mockito.Mockito.`when`
import org.junit.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class RequestSignerTest {
    private val emptySha = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

    private fun signer(captured: MutableList<String>) = RequestSigner(
        deviceId = "11111111-2222-4333-8444-555555555555",
        deviceSecret = "SECRET",
        signer = Signer { data -> captured.add(String(data, Charsets.UTF_8)); byteArrayOf(1, 2, 3) },
        clock = { 1_700_000_000_000L },
        nonce = { "NONCE" }
    )

    @Test
    fun canonicalStringMatchesProtocol() {
        val s = signer(mutableListOf())
        val c = s.canonical("get", "/v1/agents", "1700000000000", "NONCE", ByteArray(0))
        assertEquals(
            "SWARM-REQ-1\nGET\n/v1/agents\n1700000000000\nNONCE\n11111111-2222-4333-8444-555555555555\n$emptySha",
            c
        )
    }

    @Test
    fun headersCarryBearerTimestampNonceAndSignature() {
        val seen = mutableListOf<String>()
        val body = """{"text":"hi"}""".toByteArray()
        val h = signer(seen).headers("POST", "/v1/agents/abc/task", body)
        assertEquals("Bearer 11111111-2222-4333-8444-555555555555.SECRET", h["Authorization"])
        assertEquals("1700000000000", h["X-Swarm-Timestamp"])
        assertEquals("NONCE", h["X-Swarm-Nonce"])
        assertEquals(Codec.b64Url(byteArrayOf(1, 2, 3)), h["X-Swarm-Signature"])
        assertEquals(1, seen.size)
        assertTrue(seen[0].endsWith(Codec.sha256Hex(body)))
        assertTrue(seen[0].startsWith("SWARM-REQ-1\nPOST\n/v1/agents/abc/task\n"))
    }

    @Test
    fun pairProofPayloadFormat() {
        assertEquals("SWARM-PAIR-1\ntok\ndev\nPUB", RequestSigner.pairProofPayload("tok", "dev", "PUB"))
    }

    @Test
    fun base64UrlHasNoPadding() {
        assertEquals("-_8", Codec.b64Url(byteArrayOf(0xfb.toByte(), 0xff.toByte())))
        assertEquals("+/8=", Codec.b64(byteArrayOf(0xfb.toByte(), 0xff.toByte())))
        assertEquals(emptySha, Codec.sha256Hex(ByteArray(0)))
    }

    // ---- certificate pinning

    private fun cert(der: ByteArray): X509Certificate {
        val c = mock(X509Certificate::class.java)
        `when`(c.encoded).thenReturn(der)
        return c
    }

    @Test
    fun pinnedTrustManagerAcceptsOnlyMatchingFingerprint() {
        val der = "leaf-certificate-bytes".toByteArray()
        val ok = FingerprintTrustManager(Codec.sha256Hex(der))
        ok.checkServerTrusted(arrayOf(cert(der)), "ECDHE_RSA")

        val wrong = FingerprintTrustManager(Codec.sha256Hex("other".toByteArray()))
        assertFailsWith<CertificateException> { wrong.checkServerTrusted(arrayOf(cert(der)), "ECDHE_RSA") }
        assertFailsWith<CertificateException> { ok.checkServerTrusted(emptyArray(), "ECDHE_RSA") }
        assertFailsWith<CertificateException> { ok.checkClientTrusted(arrayOf(cert(der)), "RSA") }
    }

    @Test
    fun pinnedTrustManagerAcceptsColonSeparatedUppercaseFingerprint() {
        val der = "leaf".toByteArray()
        val fp = Codec.sha256Hex(der).uppercase().chunked(2).joinToString(":")
        FingerprintTrustManager(fp).checkServerTrusted(arrayOf(cert(der)), "x")
        assertContentEquals(emptyArray(), FingerprintTrustManager(fp).acceptedIssuers)
    }
}