package fr.mina.gateway.feature.voice

import fr.mina.gateway.chat.EncryptedVoiceAttachmentSink
import fr.mina.gateway.chat.EncryptedAttachmentStore
import fr.mina.gateway.chat.StoredVoiceAttachment
import fr.mina.gateway.protocol.VoicePcmFormat
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import java.io.IOException
import java.nio.file.Files
import java.security.SecureRandom

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
@OptIn(ExperimentalCoroutinesApi::class)
class VoiceNoteViewModelTest {
    private lateinit var root: File
    private val epochKey = ByteArray(32).also { SecureRandom().nextBytes(it) }

    @Before
    fun setUp() {
        root = Files.createTempDirectory("mina-voice-model-test-").toFile()
    }

    @After
    fun tearDown() {
        root.deleteRecursively()
    }

    @Test
    fun `host stop cancels an active push to talk exactly once`() = runTest {
        val controller = FakeController()
        val model = VoiceNoteViewModel(
            controller = controller,
            gateway = FakeGateway(),
            scope = this,
        )

        model.beginPushToTalk()
        assertEquals(VoiceCaptureMode.PUSH_TO_TALK, model.state.value.mode)
        model.onHostStopped()
        model.onHostStopped()

        assertEquals(1, controller.cancelCalls)
        assertFalse(model.state.value.isRecording)
    }

    @Test
    fun `failed enqueue retains the completed capture for an explicit retry`() = runTest {
        val controller = FakeController()
        val gateway = FakeGateway(failFirstEnqueue = true)
        val model = VoiceNoteViewModel(controller, gateway, this)
        val attachment = completedAttachment()

        model.beginPushToTalk()
        controller.complete(attachment)
        advanceUntilIdle()

        assertEquals(1, gateway.enqueueCalls)
        assertEquals(true, model.state.value.canRetry)

        model.retryPendingSend()
        advanceUntilIdle()

        assertEquals(2, gateway.enqueueCalls)
        assertEquals("Note vocale en file", model.state.value.note)
        assertEquals(1, gateway.kickCalls)
    }

    private fun completedAttachment(): StoredVoiceAttachment {
        val store = EncryptedAttachmentStore(
            root = root,
            epochKeyProvider = { epoch -> if (epoch == 1) epochKey.copyOf() else null },
            currentEpoch = { 1 },
        )
        val sink = store.createVoiceCapture("thread-main")
        sink.append(ByteArray(VoicePcmFormat.CHUNK_BYTES) { 3 }, VoicePcmFormat.CHUNK_BYTES)
        return sink.complete(1_000)
    }

    private class FakeController : VoiceNoteCaptureController {
        override var onResult: ((VoiceCaptureResult) -> Unit)? = null
        override var isRecording = false
        var cancelCalls = 0

        override fun start(sink: EncryptedVoiceAttachmentSink): VoiceCaptureResult {
            isRecording = true
            return VoiceCaptureResult.Recording
        }

        override fun stop(): VoiceCaptureResult {
            isRecording = false
            return VoiceCaptureResult.DiscardedTooShort
        }

        override fun cancel() {
            if (isRecording) cancelCalls += 1
            isRecording = false
        }

        override fun onHostStopped() = cancel()

        override fun close() = Unit

        fun complete(attachment: StoredVoiceAttachment) {
            isRecording = false
            onResult?.invoke(VoiceCaptureResult.Completed(attachment))
        }
    }

    private class FakeGateway(
        private var failFirstEnqueue: Boolean = false,
    ) : VoiceNoteGateway {
        var enqueueCalls = 0
        var kickCalls = 0

        override fun beginCapture(): EncryptedVoiceAttachmentSink = object : EncryptedVoiceAttachmentSink {
            override fun append(buffer: ByteArray, byteCount: Int) = Unit
            override fun complete(durationMs: Long): StoredVoiceAttachment = error("not used")
            override fun discard() = Unit
        }

        override suspend fun enqueue(capture: StoredVoiceAttachment): String {
            enqueueCalls += 1
            if (failFirstEnqueue) {
                failFirstEnqueue = false
                throw IOException("injected_enqueue_failure")
            }
            return capture.mediaId
        }

        override fun kickSync() {
            kickCalls += 1
        }
    }
}
