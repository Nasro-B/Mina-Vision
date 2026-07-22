package fr.mina.gateway.protocol

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.time.Instant
import java.util.Base64

class EnvelopeCodecTest {
    private val fixture = JSONObject(
        checkNotNull(javaClass.classLoader?.getResourceAsStream("mina-envelope-v1.json"))
            .bufferedReader().use { it.readText() },
    )
    private val envelope = EnvelopeCodec.decodeJson(fixture.getJSONObject("envelope").toString())
    private val testOnly = fixture.getJSONObject("testOnly")

    @Test
    fun verifiesSharedFixtureAndDecryptsPayload() {
        val verified = EnvelopeCodec.verifyAndDecrypt(
            envelope = envelope,
            aesKey = Base64.getDecoder().decode(testOnly.getString("aesKeyBase64")),
            publicKeySpkiBase64 = testOnly.getString("publicKeySpkiBase64"),
            nowEpochMs = Instant.parse("2026-07-15T08:00:00.000Z").toEpochMilli(),
            lastCounter = 40,
        )
        assertEquals(41, verified.counter)
        assertEquals("{\"text\":\"Bonjour Mina Vision\"}", verified.plaintext.toString(Charsets.UTF_8))
    }

    @Test
    fun rejectsReplayExpiryAndInvalidSignature() {
        val key = Base64.getDecoder().decode(testOnly.getString("aesKeyBase64"))
        val publicKey = testOnly.getString("publicKeySpkiBase64")
        val replay = assertThrows(IllegalArgumentException::class.java) {
            EnvelopeCodec.verifyAndDecrypt(envelope, key, publicKey, Instant.parse("2026-07-15T08:00:00Z").toEpochMilli(), 41)
        }
        assertEquals("envelope_replay_rejected", replay.message)
        val expired = assertThrows(IllegalArgumentException::class.java) {
            EnvelopeCodec.verifyAndDecrypt(envelope, key, publicKey, Instant.parse("2026-07-16T00:00:00Z").toEpochMilli(), 40)
        }
        assertEquals("envelope_expired", expired.message)
        val invalid = assertThrows(IllegalArgumentException::class.java) {
            EnvelopeCodec.verifyAndDecrypt(envelope.copy(signature = "AAAA"), key, publicKey, Instant.parse("2026-07-15T08:00:00Z").toEpochMilli(), 40)
        }
        assertEquals("envelope_signature_invalid", invalid.message)
    }
}
