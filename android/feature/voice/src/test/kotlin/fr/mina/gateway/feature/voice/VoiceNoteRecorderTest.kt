package fr.mina.gateway.feature.voice

import fr.mina.gateway.chat.EncryptedVoiceAttachmentSink
import fr.mina.gateway.chat.StoredVoiceAttachment
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import java.io.IOException

class VoiceNoteRecorderTest {
    @Test
    fun `focus refused does not start AudioRecord`() = runTest {
        val audioRecord = FakeAudioRecord()
        val recorder = recorder(audioRecord = audioRecord, audioFocus = FakeFocus(granted = false))

        assertEquals(VoiceCaptureResult.Failed("voice_audio_focus_refuse"), recorder.start(FakeSink()))
        assertEquals(0, audioRecord.startCalls)
    }

    @Test
    fun `focus loss during startup does not open a capture`() = runTest {
        val sink = FakeSink()
        val audioRecord = FakeAudioRecord()
        val focus = FakeFocus(loseOnRequest = true)
        val recorder = recorder(audioRecord = audioRecord, audioFocus = focus)

        assertEquals(VoiceCaptureResult.Failed("voice_audio_focus_perdu"), recorder.start(sink))
        assertEquals(0, audioRecord.startCalls)
        assertEquals(1, sink.discarded)
        assertFalse(recorder.isRecording)
        assertEquals(1, focus.abandonCalls)
    }

    @Test
    fun `capture below 300 milliseconds is discarded`() = runTest {
        var nowMs = 0L
        val sink = FakeSink()
        val recorder = recorder(clock = { nowMs })

        recorder.start(sink)
        nowMs = 299L

        assertEquals(VoiceCaptureResult.DiscardedTooShort, recorder.stop())
        assertEquals(0, sink.completed)
        assertEquals(1, sink.discarded)
    }

    @Test
    fun `focus loss read error host stop and cancel discard once`() = runTest {
        listOf<(VoiceNoteRecorder, FakeFocus, FakeAudioRecord) -> Unit>(
            { _, focus, _ -> focus.lose() },
            { recorder, _, _ -> recorder.captureOnce() },
            { recorder, _, _ -> recorder.onHostStopped() },
            { recorder, _, _ -> recorder.cancel() },
        ).forEachIndexed { index, stop ->
            val sink = FakeSink()
            val focus = FakeFocus()
            val audioRecord = FakeAudioRecord(readResult = -6)
            val recorder = recorder(audioRecord = audioRecord, audioFocus = focus)

            recorder.start(sink)
            stop(recorder, focus, audioRecord)

            assertEquals("cas $index", 1, sink.discarded)
            assertFalse("cas $index", recorder.isRecording)
            assertEquals("cas $index", 1, audioRecord.releaseCalls)
            assertEquals("cas $index", 1, focus.abandonCalls)
        }
    }

    @Test
    fun `encrypted sink write failure discards and releases the microphone`() = runTest {
        val sink = FakeSink(failOnAppend = true)
        val focus = FakeFocus()
        val audioRecord = FakeAudioRecord(readResult = 8)
        val recorder = recorder(audioRecord = audioRecord, audioFocus = focus)

        recorder.start(sink)
        val error = runCatching { recorder.captureOnce() }.exceptionOrNull()

        assertEquals(null, error)
        assertEquals(1, sink.discarded)
        assertFalse(recorder.isRecording)
        assertEquals(1, audioRecord.releaseCalls)
        assertEquals(1, focus.abandonCalls)
        assertEquals(VoiceCaptureResult.Failed("voice_capture_ecriture_echouee"), recorder.state)
    }

    private fun recorder(
        audioRecord: FakeAudioRecord = FakeAudioRecord(),
        audioFocus: FakeFocus = FakeFocus(),
        clock: () -> Long = { 0L },
    ) = VoiceNoteRecorder(
        audioRecordFactory = PcmAudioRecordFactory { audioRecord },
        audioFocus = audioFocus,
        worker = object : VoiceCaptureWorker {
            override fun execute(block: () -> Unit) = Unit
        },
        clock = clock,
    )

    private class FakeSink(
        private val failOnAppend: Boolean = false,
    ) : EncryptedVoiceAttachmentSink {
        var completed = 0
        var discarded = 0

        override fun append(buffer: ByteArray, byteCount: Int) {
            if (failOnAppend) throw IOException("injected_sink_failure")
            buffer.fill(0, 0, byteCount)
        }

        override fun complete(durationMs: Long): StoredVoiceAttachment {
            completed += 1
            error("complete ne doit pas etre appele dans ce test")
        }

        override fun discard() {
            discarded += 1
        }
    }

    private class FakeAudioRecord(
        private val readResult: Int = 0,
    ) : PcmAudioRecord {
        var startCalls = 0
        var stopCalls = 0
        var releaseCalls = 0

        override val isInitialized = true

        override fun startRecording() {
            startCalls += 1
        }

        override fun read(buffer: ByteArray, offset: Int, size: Int): Int = readResult

        override fun stop() {
            stopCalls += 1
        }

        override fun release() {
            releaseCalls += 1
        }
    }

    private class FakeFocus(
        private val granted: Boolean = true,
        private val loseOnRequest: Boolean = false,
    ) : VoiceAudioFocus {
        private var onLoss: (() -> Unit)? = null
        var abandonCalls = 0

        override fun request(onLoss: () -> Unit): Boolean {
            this.onLoss = onLoss
            if (loseOnRequest) onLoss()
            return granted
        }

        override fun abandon() {
            abandonCalls += 1
        }

        fun lose() {
            onLoss?.invoke()
        }
    }
}
