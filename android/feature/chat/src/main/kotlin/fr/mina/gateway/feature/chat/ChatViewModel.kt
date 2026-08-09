package fr.mina.gateway.feature.chat

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import fr.mina.gateway.chat.ChatEngine
import fr.mina.gateway.chat.ChatHistoryLimits
import fr.mina.gateway.chat.ChatSettings
import fr.mina.gateway.chat.LinkState
import fr.mina.gateway.chat.StoredVoiceAttachment
import fr.mina.gateway.feature.voice.VoiceNoteGateway
import fr.mina.gateway.feature.voice.VoiceNoteRecorder
import fr.mina.gateway.feature.voice.VoiceNoteUiState
import fr.mina.gateway.feature.voice.VoiceNoteViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

const val MAIN_THREAD_ID = "thread-main"

/** Ce que l'écran doit savoir pour ne rien affirmer de faux. */
data class ChatUiState(
    val paired: Boolean,
    val link: LinkState,
    val pendingCount: Int,
    val linkError: String?,
    val sendError: String?,
    val draft: String,
    val sending: Boolean,
)

class ChatViewModel(application: Application) : AndroidViewModel(application) {
    private val engine = ChatEngine.get(application)
    private val voice = VoiceNoteViewModel(
        controller = VoiceNoteRecorder.create(application),
        gateway = object : VoiceNoteGateway {
            override fun beginCapture() = engine.repository.beginVoiceCapture(MAIN_THREAD_ID)

            override suspend fun enqueue(capture: StoredVoiceAttachment): String =
                engine.repository.enqueueVoice(capture)

            override fun kickSync() = engine.start()
        },
        scope = viewModelScope,
    )

    val voiceState: StateFlow<VoiceNoteUiState> = voice.state
    val streamingResponses = engine.repository.streamingResponses

    private val historyWindow = ChatHistoryWindow()
    val historyState: StateFlow<ChatHistoryWindowState> = historyWindow.state

    private val pending = MutableStateFlow(0)
    private val sendError = MutableStateFlow<String?>(null)
    private val paired = MutableStateFlow(engine.settings.isPaired())
    private val draftController = ChatDraftController()
    private val draft = MutableStateFlow(draftController.draft)
    private val sending = MutableStateFlow(draftController.sending)
    private val composer = kotlinx.coroutines.flow.combine(draft, sending) { currentDraft, isSending ->
        currentDraft to isSending
    }

    val uiState: StateFlow<ChatUiState> = kotlinx.coroutines.flow.combine(
        engine.linkState,
        pending,
        sendError,
        paired,
        composer,
    ) { link, count, error, isPaired, currentComposer ->
        ChatUiState(
            paired = isPaired,
            link = link,
            pendingCount = count,
            linkError = engine.lastLinkError(),
            sendError = error,
            draft = currentComposer.first,
            sending = currentComposer.second,
        )
    }.stateIn(
        viewModelScope,
        SharingStarted.WhileSubscribed(5_000),
        ChatUiState(engine.settings.isPaired(), LinkState.OFFLINE, 0, null, null, "", false),
    )

    init {
        engine.start()
        refreshPending()
        viewModelScope.launch {
            engine.repository.observeThreadPage(MAIN_THREAD_ID, ChatHistoryLimits.PAGE_SIZE)
                .collect { page -> historyWindow.acceptRecent(page) }
        }
    }

    fun updateDraft(text: String) {
        draftController.update(text)
        draft.value = draftController.draft
    }

    fun sendDraft() {
        val submitted = draftController.beginSend() ?: return
        sending.value = draftController.sending
        viewModelScope.launch {
            val result = runCatching { engine.repository.sendText(MAIN_THREAD_ID, submitted) }
            result.onFailure { sendError.value = humanReason(it) }
                .onSuccess { sendError.value = null }
            draftController.finishSend(submitted, persisted = result.isSuccess)
            draft.value = draftController.draft
            sending.value = draftController.sending
            refreshPending()
        }
    }

    fun loadOlderMessages() {
        viewModelScope.launch {
            try {
                historyWindow.loadOlder { before ->
                    engine.repository.loadOlderPage(
                        threadId = MAIN_THREAD_ID,
                        before = before,
                        pageSize = ChatHistoryLimits.PAGE_SIZE,
                    )
                }
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                sendError.value = humanReason(error)
            }
        }
    }

    fun retryFailedMessage(eventId: String) {
        viewModelScope.launch {
            try {
                engine.repository.retryFailedMessage(eventId)
                sendError.value = null
                engine.start()
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                sendError.value = humanReason(error)
            }
            refreshPending()
        }
    }

    /** Envoie une image (préparée : redimensionnée, EXIF retiré) en pièce jointe chiffrée. */
    fun sendImage(uri: android.net.Uri) {
        viewModelScope.launch {
            runCatching {
                val prepared = MediaPrep.prepareImage(getApplication(), uri)
                engine.repository.sendMedia(
                    MAIN_THREAD_ID, prepared.bytes, prepared.mime,
                    mapOf("width" to prepared.width, "height" to prepared.height),
                )
            }.onFailure { sendError.value = humanReason(it) }.onSuccess { sendError.value = null }
            engine.start() // pousse tout de suite l'outbox
            refreshPending()
        }
    }

    fun beginVoiceNote() = voice.beginNote()

    fun stopVoiceNote() = voice.stopNote()

    fun cancelVoiceNote() = voice.cancel()

    fun beginPushToTalk() = voice.beginPushToTalk()

    fun endPushToTalk() = voice.endPushToTalk()

    fun retryPendingVoice() = voice.retryPendingSend()

    fun voicePermissionDenied() = voice.onPermissionDenied()

    fun onVoiceHostStopped() = voice.onHostStopped()

    /**
     * W6 — octets d'un média reçu, réassemblés en mémoire depuis les lignes chiffrées du fil.
     * Null si incomplet/altéré : la bulle affiche alors un état honnête, jamais un média partiel.
     */
    suspend fun loadMedia(mediaId: String): Pair<ByteArray, String>? =
        runCatching { engine.repository.readMediaBytes(MAIN_THREAD_ID, mediaId) }.getOrNull()

    fun dismissSendError() { sendError.value = null }

    fun retryLink() {
        engine.start()
        viewModelScope.launch { refreshPending() }
    }

    fun pair(host: String, port: Int, pairingCode: String?) {
        runCatching { engine.pair(host, port, pairingCode) }
            .onFailure { sendError.value = humanReason(it) }
            .onSuccess { paired.value = true }
    }

    fun unpair() {
        engine.unpair()
        paired.value = false
    }

    fun deviceId(): String = engine.deviceId

    fun defaultPort(): Int = ChatSettings.DEFAULT_PORT

    fun pairedHost(): String = engine.settings.host().orEmpty()

    override fun onCleared() {
        voice.close()
        super.onCleared()
    }

    private fun refreshPending() {
        viewModelScope.launch { pending.value = engine.repository.pendingCount() }
    }

    /** Traduit une cause technique en phrase utile — jamais un « une erreur est survenue » creux. */
    private fun humanReason(error: Throwable): String = when (error.message) {
        "chat_coffre_verrouille" -> "Mémoire verrouillée : déverrouillez-la pour écrire."
        "chat_message_vide" -> "Message vide."
        "chat_message_trop_long" -> "Message trop long (maximum 32 KiB)."
        "chat_outbox_pleine" -> "Trop de messages en attente. Rallumez le PC pour les envoyer."
        "chat_retry_non_reessayable" -> "Ce message ne peut plus être réessayé."
        "chat_hote_vide" -> "Adresse du PC manquante."
        "chat_port_invalide" -> "Port invalide (1 à 65535)."
        "chat_pc_sans_pieces_jointes" -> "Ce PC ne prend pas encore les pièces jointes. Mettez Mina à jour côté PC."
        else -> error.message ?: "Envoi impossible."
    }
}
