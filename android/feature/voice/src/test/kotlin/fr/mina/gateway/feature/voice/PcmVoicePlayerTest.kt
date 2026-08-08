package fr.mina.gateway.feature.voice

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class PcmVoicePlayerTest {
    @Test
    fun `play streams PCM and clears caller bytes`() = runTest {
        val track = FakeAudioTrack()
        val player = PcmVoicePlayer(
            audioTrackFactory = PcmAudioTrackFactory { track },
            clock = { 0L },
            awaitPlayback = {},
        )
        val bytes = ByteArray(8) { (it + 1).toByte() }

        player.play(bytes)

        assertEquals(1, track.playCalls)
        assertEquals(1, track.stopCalls)
        assertEquals(1, track.releaseCalls)
        assertArrayEquals(ByteArray(bytes.size), bytes)
        assertArrayEquals(byteArrayOf(1, 2, 3, 4, 5, 6, 7, 8), track.written.toByteArray())
    }

    @Test
    fun `play clears caller bytes when AudioTrack write fails`() = runTest {
        val player = PcmVoicePlayer(
            audioTrackFactory = PcmAudioTrackFactory { FakeAudioTrack(writeResult = -1) },
            clock = { 0L },
            awaitPlayback = {},
        )
        val bytes = ByteArray(8) { 7 }

        val error = runCatching { player.play(bytes) }.exceptionOrNull()

        assertEquals("voice_playback_write_echoue", error?.message)
        assertArrayEquals(ByteArray(bytes.size), bytes)
    }

    @Test
    fun `play waits for the remaining PCM duration before releasing AudioTrack`() = runTest {
        var waitedMs = -1L
        val player = PcmVoicePlayer(
            audioTrackFactory = PcmAudioTrackFactory { FakeAudioTrack() },
            clock = { 0L },
            awaitPlayback = { waitedMs = it },
        )

        player.play(ByteArray(32_000) { 1 })

        assertEquals(1_050L, waitedMs)
    }

    private class FakeAudioTrack(
        private val writeResult: Int? = null,
    ) : PcmAudioTrack {
        var playCalls = 0
        var stopCalls = 0
        var releaseCalls = 0
        val written = ArrayList<Byte>()

        override val isInitialized = true

        override fun play() {
            playCalls += 1
        }

        override fun write(bytes: ByteArray, offset: Int, size: Int): Int {
            writeResult?.let { return it }
            for (index in offset until offset + size) written += bytes[index]
            return size
        }

        override fun stop() {
            stopCalls += 1
        }

        override fun release() {
            releaseCalls += 1
        }
    }
}
