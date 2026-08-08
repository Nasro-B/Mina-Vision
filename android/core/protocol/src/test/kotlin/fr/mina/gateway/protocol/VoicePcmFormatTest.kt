package fr.mina.gateway.protocol

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class VoicePcmFormatTest {
    @Test
    fun pcmVoiceContractStaysCanonical() {
        assertEquals("audio/L16;rate=16000;channels=1", VoicePcmFormat.MIME)
        assertEquals(16_000, VoicePcmFormat.SAMPLE_RATE_HZ)
        assertEquals(1, VoicePcmFormat.CHANNEL_COUNT)
        assertEquals(2, VoicePcmFormat.BYTES_PER_SAMPLE)
        assertEquals(32_000, VoicePcmFormat.CHUNK_BYTES)
        assertEquals(50 * 1024 * 1024, VoicePcmFormat.MAX_BYTES)
        assertTrue(VoicePcmFormat.isCanonicalMime(VoicePcmFormat.MIME))
        assertFalse(VoicePcmFormat.isCanonicalMime("audio/L16;rate=8000;channels=1"))
    }
}
