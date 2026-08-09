package fr.mina.gateway.feature.chat

import fr.mina.gateway.chat.ChatHistoryLimits
import fr.mina.gateway.chat.ChatMessage
import fr.mina.gateway.chat.ChatMessagePage
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** La seule fenêtre de bulles déchiffrées conservée par l'écran. */
data class ChatHistoryWindowState(
    val messages: List<ChatMessage> = emptyList(),
    val hasOlder: Boolean = false,
    val loadingOlder: Boolean = false,
    val lastChangeWasOlder: Boolean = false,
)

/**
 * Maintient une fenêtre de l'historique : les nouvelles pages se placent avant la fenêtre,
 * puis les bulles les plus récentes sont évincées si la borne de confidentialité est atteinte.
 */
class ChatHistoryWindow(
    private val maxItems: Int = ChatHistoryLimits.MAX_DECRYPTED_UI_ITEMS,
) {
    private val mutationLock = Mutex()
    private val mutableState = MutableStateFlow(ChatHistoryWindowState())

    val state: StateFlow<ChatHistoryWindowState> = mutableState

    init {
        require(maxItems in 1..ChatHistoryLimits.MAX_DECRYPTED_UI_ITEMS) { "chat_history_window_invalid" }
    }

    suspend fun acceptRecent(page: ChatMessagePage) = mutationLock.withLock {
        val current = mutableState.value
        if (current.messages.isEmpty() || page.messages.isEmpty()) {
            mutableState.value = ChatHistoryWindowState(
                messages = page.messages.takeLast(maxItems),
                hasOlder = page.hasOlder,
            )
            return@withLock
        }

        val recentIds = page.messages.mapTo(HashSet(page.messages.size)) { it.eventId }
        if (current.messages.last().eventId !in recentIds) return@withLock

        val previous = current.messages.filterNot { it.eventId in recentIds }
        val messages = (previous + page.messages).takeLast(maxItems)
        val latestChanged = current.messages.last().eventId != page.messages.last().eventId
        mutableState.value = ChatHistoryWindowState(
            messages = messages,
            hasOlder = if (previous.isEmpty()) page.hasOlder else current.hasOlder,
            lastChangeWasOlder = if (latestChanged) false else current.lastChangeWasOlder,
        )
    }

    suspend fun loadOlder(loadPage: suspend (ChatMessage) -> ChatMessagePage) {
        if (!mutationLock.tryLock()) return
        try {
            val current = mutableState.value
            val before = current.messages.firstOrNull() ?: return
            if (!current.hasOlder) return

            mutableState.value = current.copy(loadingOlder = true)
            try {
                val older = loadPage(before)
                mutableState.value = ChatHistoryWindowState(
                    messages = prependAndBound(older.messages, current.messages),
                    hasOlder = older.hasOlder,
                    lastChangeWasOlder = true,
                )
            } catch (error: Throwable) {
                mutableState.value = current
                throw error
            }
        } finally {
            mutationLock.unlock()
        }
    }

    private fun prependAndBound(older: List<ChatMessage>, current: List<ChatMessage>): List<ChatMessage> {
        val eventIds = HashSet<String>(maxItems)
        val messages = ArrayList<ChatMessage>(maxItems)
        fun append(message: ChatMessage) {
            if (messages.size < maxItems && eventIds.add(message.eventId)) messages += message
        }
        older.forEach(::append)
        current.forEach(::append)
        return messages
    }
}
