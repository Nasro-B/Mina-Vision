package fr.mina.gateway.feature.voice

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.SystemClock
import fr.mina.gateway.protocol.VoicePcmFormat
import kotlinx.coroutines.delay

internal interface PcmAudioTrack {
    val isInitialized: Boolean
    fun play()
    fun write(bytes: ByteArray, offset: Int, size: Int): Int
    fun stop()
    fun release()
}

internal fun interface PcmAudioTrackFactory {
    fun create(): PcmAudioTrack
}

/** Lit le PCM canonique directement dans AudioTrack : aucun fichier temporaire n'est nécessaire. */
class PcmVoicePlayer internal constructor(
    private val audioTrackFactory: PcmAudioTrackFactory,
    private val clock: () -> Long = SystemClock::elapsedRealtime,
    private val awaitPlayback: suspend (Long) -> Unit = { delay(it) },
) {
    suspend fun play(bytes: ByteArray) {
        var track: PcmAudioTrack? = null
        try {
            require(bytes.isNotEmpty() && bytes.size % VoicePcmFormat.BYTES_PER_SAMPLE == 0) {
                "voice_playback_pcm_invalide"
            }
            track = audioTrackFactory.create()
            require(track.isInitialized) { "voice_playback_track_invalide" }
            val startedAtMs = clock()
            track.play()
            var offset = 0
            while (offset < bytes.size) {
                val expected = minOf(VoicePcmFormat.CHUNK_BYTES, bytes.size - offset)
                val written = track.write(bytes, offset, expected)
                require(written in 1..expected) { "voice_playback_write_echoue" }
                offset += written
            }
            val durationMs = (bytes.size.toLong() * 1_000 + PCM_BYTES_PER_SECOND - 1) / PCM_BYTES_PER_SECOND
            val elapsedMs = (clock() - startedAtMs).coerceAtLeast(0)
            awaitPlayback((durationMs - elapsedMs).coerceAtLeast(0) + PLAYBACK_TAIL_MS)
        } finally {
            track?.let {
                runCatching { it.stop() }
                runCatching { it.release() }
            }
            bytes.fill(0)
        }
    }

    companion object {
        private const val PCM_BYTES_PER_SECOND = VoicePcmFormat.SAMPLE_RATE_HZ * VoicePcmFormat.BYTES_PER_SAMPLE
        private const val PLAYBACK_TAIL_MS = 50L

        fun create(): PcmVoicePlayer = PcmVoicePlayer(AndroidPcmAudioTrackFactory)
    }
}

private object AndroidPcmAudioTrackFactory : PcmAudioTrackFactory {
    override fun create(): PcmAudioTrack = AndroidPcmAudioTrack(
        AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build(),
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setSampleRate(VoicePcmFormat.SAMPLE_RATE_HZ)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .build(),
            )
            .setTransferMode(AudioTrack.MODE_STREAM)
            .setBufferSizeInBytes(VoicePcmFormat.CHUNK_BYTES)
            .build(),
    )
}

private class AndroidPcmAudioTrack(
    private val delegate: AudioTrack,
) : PcmAudioTrack {
    override val isInitialized: Boolean get() = delegate.state == AudioTrack.STATE_INITIALIZED

    override fun play() = delegate.play()

    override fun write(bytes: ByteArray, offset: Int, size: Int): Int =
        delegate.write(bytes, offset, size, AudioTrack.WRITE_BLOCKING)

    override fun stop() = delegate.stop()

    override fun release() = delegate.release()
}
