package fr.mina.gateway.feature.voice

import android.annotation.SuppressLint
import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.MediaRecorder
import fr.mina.gateway.chat.EncryptedVoiceAttachmentSink
import fr.mina.gateway.chat.StoredVoiceAttachment
import fr.mina.gateway.protocol.VoicePcmFormat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/** Résultat factuel d'une action de capture : aucune réponse audio n'est fabriquée localement. */
sealed interface VoiceCaptureResult {
    data object Idle : VoiceCaptureResult
    data object Recording : VoiceCaptureResult
    data class Completed(val attachment: StoredVoiceAttachment) : VoiceCaptureResult
    data class Failed(val reason: String) : VoiceCaptureResult
    data object DiscardedTooShort : VoiceCaptureResult
}

/** Contrat du recorder pour le contrôleur UI ; les tests n'ouvrent jamais le microphone réel. */
interface VoiceNoteCaptureController {
    var onResult: ((VoiceCaptureResult) -> Unit)?
    val isRecording: Boolean
    fun start(sink: EncryptedVoiceAttachmentSink): VoiceCaptureResult
    fun stop(): VoiceCaptureResult
    fun cancel()
    fun onHostStopped()
    fun close()
}

/** Adaptateur testable autour d'AudioRecord : le test n'ouvre jamais le microphone. */
internal interface PcmAudioRecord {
    val isInitialized: Boolean
    fun startRecording()
    fun read(buffer: ByteArray, offset: Int, size: Int): Int
    fun stop()
    fun release()
}

internal fun interface PcmAudioRecordFactory {
    fun create(): PcmAudioRecord
}

/** Le focus audio est une ressource exclusive pendant la note, jamais acquise au démarrage de l'app. */
internal interface VoiceAudioFocus {
    fun request(onLoss: () -> Unit): Boolean
    fun abandon()
}

/** Exécuteur isolé pour que le lecteur de tests puisse contrôler les lectures une par une. */
internal interface VoiceCaptureWorker {
    fun execute(block: () -> Unit)
    fun close() = Unit
}

/**
 * Capture PCM16 mono 16 kHz. Aucun fichier audio n'est créé : les paquets passent directement au
 * sink chiffré, qui les efface après chiffrement. Cette classe n'écoute qu'après une action UI.
 */
class VoiceNoteRecorder internal constructor(
    private val audioRecordFactory: PcmAudioRecordFactory,
    private val audioFocus: VoiceAudioFocus,
    private val worker: VoiceCaptureWorker,
    private val clock: () -> Long = System::currentTimeMillis,
) : VoiceNoteCaptureController {
    private val lock = Any()
    private var active: ActiveCapture? = null
    private var opening = false
    private var focusLostWhileOpening = false

    @Volatile
    var state: VoiceCaptureResult = VoiceCaptureResult.Idle
        private set

    @Volatile
    override var onResult: ((VoiceCaptureResult) -> Unit)? = null

    override val isRecording: Boolean get() = synchronized(lock) { active != null }

    /** Demande le focus avant d'ouvrir réellement AudioRecord. */
    override fun start(sink: EncryptedVoiceAttachmentSink): VoiceCaptureResult {
        if (!beginOpening()) {
            sink.discard()
            return publish(VoiceCaptureResult.Failed("voice_deja_en_cours"))
        }
        if (!audioFocus.request(::onAudioFocusLoss)) {
            endOpening()
            audioFocus.abandon()
            sink.discard()
            return publish(VoiceCaptureResult.Failed("voice_audio_focus_refuse"))
        }
        if (openingLostFocus()) {
            endOpening()
            audioFocus.abandon()
            sink.discard()
            return publish(VoiceCaptureResult.Failed("voice_audio_focus_perdu"))
        }

        val recorder = try {
            audioRecordFactory.create()
        } catch (error: SecurityException) {
            endOpening()
            audioFocus.abandon()
            sink.discard()
            return publish(VoiceCaptureResult.Failed("voice_audio_record_permission_refusee"))
        } catch (error: Exception) {
            endOpening()
            audioFocus.abandon()
            sink.discard()
            return publish(VoiceCaptureResult.Failed("voice_audio_record_indisponible"))
        }
        if (!recorder.isInitialized) {
            endOpening()
            runCatching { recorder.release() }
            audioFocus.abandon()
            sink.discard()
            return publish(VoiceCaptureResult.Failed("voice_audio_record_invalide"))
        }
        try {
            recorder.startRecording()
        } catch (error: Exception) {
            endOpening()
            runCatching { recorder.release() }
            audioFocus.abandon()
            sink.discard()
            return publish(VoiceCaptureResult.Failed("voice_audio_record_demarrage_echoue"))
        }

        val capture = ActiveCapture(sink, recorder, clock())
        if (!activate(capture)) {
            closeAudio(capture)
            runCatching { sink.discard() }
            return publish(VoiceCaptureResult.Failed("voice_audio_focus_perdu"))
        }
        publish(VoiceCaptureResult.Recording)
        worker.execute { captureLoop(capture) }
        return VoiceCaptureResult.Recording
    }

    /** Termine volontairement : une note trop courte est supprimée, elle n'est jamais envoyée vide. */
    override fun stop(): VoiceCaptureResult = takeActive()?.let(::complete) ?: state

    /** Annulation utilisateur, perte de focus ou arrêt de l'écran : efface la capture une seule fois. */
    override fun cancel() {
        takeActive()?.let { discard(it, VoiceCaptureResult.Idle) }
    }

    override fun onHostStopped() = cancel()

    /** Fermeture définitive du propriétaire Compose/ViewModel. */
    override fun close() {
        cancel()
        worker.close()
    }

    /** Point de test et itération unique du worker : aucun buffer ne survit à cette méthode. */
    internal fun captureOnce() {
        val capture = synchronized(lock) { active } ?: return
        val buffer = ByteArray(VoicePcmFormat.CHUNK_BYTES)
        try {
            captureInto(capture, buffer)
        } finally {
            buffer.fill(0)
        }
    }

    private fun captureLoop(capture: ActiveCapture) {
        val buffer = ByteArray(VoicePcmFormat.CHUNK_BYTES)
        try {
            while (captureInto(capture, buffer)) Unit
        } finally {
            buffer.fill(0)
        }
    }

    /** Renvoie false quand cette session est terminée ou abandonnée. */
    private fun captureInto(capture: ActiveCapture, buffer: ByteArray): Boolean {
        if (!isActive(capture)) return false
        if (durationMs(capture) >= VoicePcmFormat.MAX_DURATION_MS ||
            capture.bytes >= VoicePcmFormat.MAX_BYTES
        ) {
            complete(takeActive(capture) ?: return false)
            return false
        }

        val remaining = VoicePcmFormat.MAX_BYTES - capture.bytes
        val read = try {
            capture.recorder.read(buffer, 0, minOf(buffer.size, remaining))
        } catch (error: Exception) {
            discard(takeActive(capture) ?: return false, VoiceCaptureResult.Failed("voice_audio_read_echec"))
            return false
        }
        if (read <= 0) {
            discard(takeActive(capture) ?: return false, VoiceCaptureResult.Failed(readFailureReason(read)))
            return false
        }

        var reachedLimit = false
        try {
            synchronized(lock) {
                if (active != capture) return false
                capture.sink.append(buffer, read)
                capture.bytes += read
                reachedLimit = capture.bytes >= VoicePcmFormat.MAX_BYTES ||
                    durationMs(capture) >= VoicePcmFormat.MAX_DURATION_MS
            }
        } catch (error: Exception) {
            discard(takeActive(capture) ?: return false, VoiceCaptureResult.Failed("voice_capture_ecriture_echouee"))
            return false
        }
        if (reachedLimit) {
            complete(takeActive(capture) ?: return false)
            return false
        }
        return isActive(capture)
    }

    private fun complete(capture: ActiveCapture): VoiceCaptureResult {
        closeAudio(capture)
        val duration = durationMs(capture)
        val result = if (duration < VoicePcmFormat.MIN_DURATION_MS || capture.bytes <= 0) {
            runCatching { capture.sink.discard() }
            VoiceCaptureResult.DiscardedTooShort
        } else {
            runCatching { capture.sink.complete(duration) }
                .fold(
                    onSuccess = { VoiceCaptureResult.Completed(it) },
                    onFailure = {
                        runCatching { capture.sink.discard() }
                        VoiceCaptureResult.Failed("voice_capture_finalisation_echouee")
                    },
                )
        }
        return publish(result)
    }

    private fun discard(capture: ActiveCapture, result: VoiceCaptureResult) {
        closeAudio(capture)
        runCatching { capture.sink.discard() }
        publish(result)
    }

    private fun closeAudio(capture: ActiveCapture) {
        runCatching { capture.recorder.stop() }
        runCatching { capture.recorder.release() }
        audioFocus.abandon()
    }

    private fun onAudioFocusLoss() {
        val capture = synchronized(lock) {
            if (opening) {
                focusLostWhileOpening = true
                null
            } else {
                active.also { active = null }
            }
        }
        capture?.let { discard(it, VoiceCaptureResult.Failed("voice_audio_focus_perdu")) }
    }

    private fun beginOpening(): Boolean = synchronized(lock) {
        if (active != null || opening) false
        else {
            opening = true
            focusLostWhileOpening = false
            true
        }
    }

    private fun openingLostFocus(): Boolean = synchronized(lock) { focusLostWhileOpening }

    private fun endOpening() {
        synchronized(lock) {
            opening = false
            focusLostWhileOpening = false
        }
    }

    private fun activate(capture: ActiveCapture): Boolean = synchronized(lock) {
        val canActivate = opening && !focusLostWhileOpening && active == null
        opening = false
        focusLostWhileOpening = false
        if (canActivate) active = capture
        canActivate
    }

    private fun takeActive(expected: ActiveCapture? = null): ActiveCapture? = synchronized(lock) {
        val current = active ?: return@synchronized null
        if (expected != null && current != expected) return@synchronized null
        active = null
        current
    }

    private fun isActive(capture: ActiveCapture): Boolean = synchronized(lock) { active == capture }

    private fun durationMs(capture: ActiveCapture): Long = (clock() - capture.startedAtMs).coerceAtLeast(0)

    private fun readFailureReason(read: Int): String = when (read) {
        AudioRecord.ERROR_BAD_VALUE -> "voice_audio_read_bad_value"
        AudioRecord.ERROR_DEAD_OBJECT -> "voice_audio_read_dead_object"
        AudioRecord.ERROR_INVALID_OPERATION -> "voice_audio_read_invalid_operation"
        else -> "voice_audio_read_echec"
    }

    private fun publish(result: VoiceCaptureResult): VoiceCaptureResult {
        state = result
        runCatching { onResult?.invoke(result) }
        return result
    }

    private data class ActiveCapture(
        val sink: EncryptedVoiceAttachmentSink,
        val recorder: PcmAudioRecord,
        val startedAtMs: Long,
        var bytes: Int = 0,
    )

    companion object {
        fun create(context: Context): VoiceNoteRecorder = VoiceNoteRecorder(
            audioRecordFactory = AndroidPcmAudioRecordFactory(context.applicationContext),
            audioFocus = AndroidVoiceAudioFocus(context.applicationContext),
            worker = CoroutineVoiceCaptureWorker(),
        )
    }
}

private class AndroidPcmAudioRecordFactory(
    private val context: Context,
) : PcmAudioRecordFactory {
    @SuppressLint("MissingPermission")
    override fun create(): PcmAudioRecord {
        if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            throw SecurityException("voice_record_audio_permission_missing")
        }
        val minBuffer = AudioRecord.getMinBufferSize(
            VoicePcmFormat.SAMPLE_RATE_HZ,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
        )
        require(minBuffer > 0) { "voice_audio_record_buffer_invalide" }
        val record = AudioRecord(
            MediaRecorder.AudioSource.VOICE_RECOGNITION,
            VoicePcmFormat.SAMPLE_RATE_HZ,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            maxOf(minBuffer * 2, VoicePcmFormat.CHUNK_BYTES),
        )
        return AndroidPcmAudioRecord(record)
    }
}

private class AndroidPcmAudioRecord(
    private val delegate: AudioRecord,
) : PcmAudioRecord {
    override val isInitialized: Boolean get() = delegate.state == AudioRecord.STATE_INITIALIZED

    override fun startRecording() = delegate.startRecording()

    override fun read(buffer: ByteArray, offset: Int, size: Int): Int =
        delegate.read(buffer, offset, size, AudioRecord.READ_BLOCKING)

    override fun stop() = delegate.stop()

    override fun release() = delegate.release()
}

private class AndroidVoiceAudioFocus(context: Context) : VoiceAudioFocus {
    private val audioManager = context.getSystemService(AudioManager::class.java)
    private var request: AudioFocusRequest? = null

    override fun request(onLoss: () -> Unit): Boolean {
        val listener = AudioManager.OnAudioFocusChangeListener { change ->
            if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) onLoss()
        }
        val focusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
            .setOnAudioFocusChangeListener(listener)
            .setAcceptsDelayedFocusGain(false)
            .build()
        request = focusRequest
        return audioManager.requestAudioFocus(focusRequest) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    }

    override fun abandon() {
        request?.let(audioManager::abandonAudioFocusRequest)
        request = null
    }
}

private class CoroutineVoiceCaptureWorker : VoiceCaptureWorker {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun execute(block: () -> Unit) {
        scope.launch { block() }
    }

    override fun close() {
        scope.cancel()
    }
}
