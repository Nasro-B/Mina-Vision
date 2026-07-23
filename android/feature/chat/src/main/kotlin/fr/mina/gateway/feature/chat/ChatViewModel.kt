package fr.mina.gateway.feature.chat

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import fr.mina.gateway.chat.ChatEngine
import fr.mina.gateway.chat.ChatMessage
import fr.mina.gateway.chat.ChatSettings
import fr.mina.gateway.chat.LinkState
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

const val MAIN_THREAD_ID = "thread-main"

/** Ce que l'écran doit savoir pour ne rien affirmer de faux. */
data class ChatUiState(
    val paired: Boolean,
    val link: LinkState,
    val pendingCount: Int,
    val linkError: String?,
    val sendError: String?,
)

class ChatViewModel(application: Application) : AndroidViewModel(application) {
    private val engine = ChatEngine.get(application)

    val messages: StateFlow<List<ChatMessage>> = engine.repository.observeThread(MAIN_THREAD_ID)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    private val pending = MutableStateFlow(0)
    private val sendError = MutableStateFlow<String?>(null)
    private val paired = MutableStateFlow(engine.settings.isPaired())

    val uiState: StateFlow<ChatUiState> = kotlinx.coroutines.flow.combine(
        engine.linkState,
        pending,
        sendError,
        paired,
    ) { link, count, error, isPaired ->
        ChatUiState(
            paired = isPaired,
            link = link,
            pendingCount = count,
            linkError = engine.lastLinkError(),
            sendError = error,
        )
    }.stateIn(
        viewModelScope,
        SharingStarted.WhileSubscribed(5_000),
        ChatUiState(engine.settings.isPaired(), LinkState.OFFLINE, 0, null, null),
    )

    init {
        engine.start()
        refreshPending()
    }

    fun send(text: String) {
        if (text.isBlank()) return
        viewModelScope.launch {
            runCatching { engine.repository.sendText(MAIN_THREAD_ID, text.trim()) }
                .onFailure { sendError.value = humanReason(it) }
                .onSuccess { sendError.value = null }
            refreshPending()
        }
    }

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

    private fun refreshPending() {
        viewModelScope.launch { pending.value = engine.repository.pendingCount() }
    }

    /** Traduit une cause technique en phrase utile — jamais un « une erreur est survenue » creux. */
    private fun humanReason(error: Throwable): String = when (error.message) {
        "chat_coffre_verrouille" -> "Mémoire verrouillée : déverrouillez-la pour écrire."
        "chat_message_vide" -> "Message vide."
        "chat_outbox_pleine" -> "Trop de messages en attente. Rallumez le PC pour les envoyer."
        "chat_hote_vide" -> "Adresse du PC manquante."
        "chat_port_invalide" -> "Port invalide (1 à 65535)."
        else -> error.message ?: "Envoi impossible."
    }
}
