package fr.mina.gateway.feature.voice

import android.content.Context
import fr.mina.gateway.chat.EncryptedVoiceAttachmentSink
import fr.mina.gateway.chat.StoredVoiceAttachment
import org.junit.Assert.assertEquals
import org.junit.runner.RunWith
import org.junit.Test
import org.robolectric.RuntimeEnvironment
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class VoiceNoteRecorderAndroidTest {
    @Test
    fun `recorder refuses microphone capture when record audio permission is missing`() {
        val context = RuntimeEnvironment.getApplication() as Context
        val recorder = VoiceNoteRecorder.create(context)

        val result = recorder.start(FakeSink())

        assertEquals(VoiceCaptureResult.Failed("voice_audio_record_permission_refusee"), result)
    }

    private class FakeSink : EncryptedVoiceAttachmentSink {
        override fun append(buffer: ByteArray, byteCount: Int) = Unit
        override fun complete(durationMs: Long): StoredVoiceAttachment = error("not used")
        override fun discard() = Unit
    }
}
