package fr.mina.gateway.protocol

object VoicePcmFormat {
    const val MIME = "audio/L16;rate=16000;channels=1"
    const val SAMPLE_RATE_HZ = 16_000
    const val CHANNEL_COUNT = 1
    const val BYTES_PER_SAMPLE = 2
    const val CHUNK_BYTES = SAMPLE_RATE_HZ * CHANNEL_COUNT * BYTES_PER_SAMPLE
    const val MAX_BYTES = 50 * 1024 * 1024
    const val MIN_DURATION_MS = 300L
    const val MAX_DURATION_MS = 30L * 60L * 1_000L

    fun isCanonicalMime(mime: String): Boolean = mime == MIME
}
