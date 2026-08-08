package fr.mina.gateway.feature.voice

import fr.mina.gateway.chat.EncryptedVoiceAttachmentSink
import fr.mina.gateway.chat.StoredVoiceAttachment
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

enum class VoiceCaptureMode {
    NOTE,
    PUSH_TO_TALK,
}

/** État UI sans promesse de livraison : « en file » n'arrive qu'après écriture durable de l'outbox. */
data class VoiceNoteUiState(
    val mode: VoiceCaptureMode? = null,
    val note: String? = null,
    val enqueuing: Boolean = false,
    val canRetry: Boolean = false,
) {
    val isRecording: Boolean get() = mode != null
}

/** Pont minimal vers ChatRepository, injectable pour ne pas coupler le contrôle de micro à l'UI. */
interface VoiceNoteGateway {
    fun beginCapture(): EncryptedVoiceAttachmentSink
    suspend fun enqueue(capture: StoredVoiceAttachment): String
    fun kickSync()
}

/**
 * Coordonne les contrôles note et PTT. Le PCM n'est jamais exposé à Compose : seul le sink chiffré
 * puis l'identifiant média survivent à la capture. Si l'outbox refuse temporairement, la capture
 * reste chiffrée et le bouton Réessayer garde exactement le même plan de livraison.
 */
class VoiceNoteViewModel(
    private val controller: VoiceNoteCaptureController,
    private val gateway: VoiceNoteGateway,
    private val scope: CoroutineScope,
) {
    private val mutableState = MutableStateFlow(VoiceNoteUiState())
    val state: StateFlow<VoiceNoteUiState> = mutableState.asStateFlow()
    private var pendingCapture: StoredVoiceAttachment? = null

    init {
        controller.onResult = ::onRecorderResult
    }

    fun beginNote() = begin(VoiceCaptureMode.NOTE)

    fun beginPushToTalk() = begin(VoiceCaptureMode.PUSH_TO_TALK)

    fun stopNote() {
        if (mutableState.value.mode == VoiceCaptureMode.NOTE) finishActiveCapture()
    }

    fun endPushToTalk() {
        if (mutableState.value.mode == VoiceCaptureMode.PUSH_TO_TALK) finishActiveCapture()
    }

    fun cancel() {
        if (!controller.isRecording) return
        controller.cancel()
        mutableState.value = mutableState.value.copy(mode = null, note = null)
    }

    fun onHostStopped() {
        if (!controller.isRecording) return
        controller.onHostStopped()
        mutableState.value = mutableState.value.copy(mode = null, note = null)
    }

    fun retryPendingSend() {
        val capture = pendingCapture ?: return
        if (mutableState.value.enqueuing) return
        enqueue(capture)
    }

    fun onPermissionDenied() {
        if (controller.isRecording) controller.cancel()
        mutableState.value = VoiceNoteUiState(note = "Permission micro refusée : note vocale impossible.")
    }

    fun close() {
        controller.onResult = null
        controller.close()
    }

    private fun begin(mode: VoiceCaptureMode) {
        if (controller.isRecording || pendingCapture != null || mutableState.value.enqueuing) return
        val sink = runCatching { gateway.beginCapture() }.getOrElse { error ->
            mutableState.value = mutableState.value.copy(note = humanReason(error), canRetry = false)
            return
        }
        mutableState.value = VoiceNoteUiState(mode = mode)
        val result = runCatching { controller.start(sink) }
            .getOrElse { VoiceCaptureResult.Failed("voice_audio_record_demarrage_echoue") }
        if (result !is VoiceCaptureResult.Recording) onRecorderResult(result)
    }

    private fun finishActiveCapture() {
        val result = controller.stop()
        if (result !is VoiceCaptureResult.Recording) onRecorderResult(result)
    }

    private fun onRecorderResult(result: VoiceCaptureResult) {
        when (result) {
            VoiceCaptureResult.Recording -> Unit
            VoiceCaptureResult.Idle -> mutableState.value = mutableState.value.copy(mode = null, note = null)
            VoiceCaptureResult.DiscardedTooShort -> {
                mutableState.value = VoiceNoteUiState(note = "Note vocale trop courte — rien envoyé.")
            }
            is VoiceCaptureResult.Failed -> {
                mutableState.value = VoiceNoteUiState(note = humanReason(result.reason))
            }
            is VoiceCaptureResult.Completed -> enqueue(result.attachment)
        }
    }

    private fun enqueue(capture: StoredVoiceAttachment) {
        if (pendingCapture === capture && mutableState.value.enqueuing) return
        pendingCapture = capture
        mutableState.value = VoiceNoteUiState(note = "Note vocale en cours d'envoi…", enqueuing = true)
        scope.launch {
            val result = runCatching { gateway.enqueue(capture) }
            if (result.isSuccess && pendingCapture === capture) {
                pendingCapture = null
                gateway.kickSync()
                mutableState.value = VoiceNoteUiState(note = "Note vocale en file")
            } else if (pendingCapture === capture) {
                mutableState.value = VoiceNoteUiState(
                    note = "Note vocale conservée sur cet appareil — réessayez quand Mina PC est disponible.",
                    canRetry = true,
                )
            }
        }
    }

    private fun humanReason(error: Throwable): String = humanReason(error.message)

    private fun humanReason(reason: String?): String = when (reason) {
        "chat_coffre_verrouille" -> "Mémoire verrouillée : déverrouillez-la pour enregistrer."
        "chat_pc_sans_pieces_jointes" -> "Ce PC ne prend pas encore les notes vocales."
        "voice_audio_focus_refuse" -> "Le microphone est déjà utilisé par une autre application."
        "voice_audio_focus_perdu" -> "La note vocale a été interrompue par une autre application."
        else -> reason ?: "Note vocale impossible."
    }
}
