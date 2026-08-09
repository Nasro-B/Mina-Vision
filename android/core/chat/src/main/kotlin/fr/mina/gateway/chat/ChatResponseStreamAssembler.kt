package fr.mina.gateway.chat

import fr.mina.gateway.protocol.AssistantResponseFrame
import fr.mina.gateway.protocol.AssistantResponseStream
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** Réponse progressive déchiffrée, limitée à la mémoire de l'interface. */
data class ChatStreamingResponse(
    val responseId: String,
    val sourceEventId: String,
    val text: String,
)

/**
 * Assemble les fragments déjà authentifiés et déchiffrés d'une réponse de Mina.
 *
 * Cet objet ne connaît ni Room ni disque : son état disparaît avec le processus. Le terminal
 * durable (`assistant.response.completed`) reste l'autorité de l'historique chiffré.
 */
class ChatResponseStreamAssembler {
    private val lock = Any()
    private val active = LinkedHashMap<String, ActiveResponse>()
    private val _responses = MutableStateFlow<List<ChatStreamingResponse>>(emptyList())

    val responses: StateFlow<List<ChatStreamingResponse>> = _responses

    fun accept(frame: AssistantResponseFrame): ChatStreamingResponse? = synchronized(lock) {
        when (frame.type) {
            "assistant.response.started" -> acceptStarted(frame)
            "assistant.response.chunk" -> acceptChunk(frame)
            "assistant.response.completed", "assistant.response.failed" -> acceptTerminal(frame)
            else -> null
        }
    }

    private fun acceptStarted(frame: AssistantResponseFrame): ChatStreamingResponse {
        val existing = active[frame.responseId]
        if (existing != null) return snapshot(frame.responseId, existing)
        val response = ActiveResponse(frame.sourceEventId)
        active[frame.responseId] = response
        publish()
        return snapshot(frame.responseId, response)
    }

    private fun acceptChunk(frame: AssistantResponseFrame): ChatStreamingResponse? {
        val response = active[frame.responseId] ?: return null
        if (response.sourceEventId != frame.sourceEventId) return snapshot(frame.responseId, response)
        val text = frame.text ?: return snapshot(frame.responseId, response)
        if (frame.sequence < response.nextSequence) return snapshot(frame.responseId, response)

        if (frame.sequence > response.nextSequence) {
            if (response.buffered.containsKey(frame.sequence)) return snapshot(frame.responseId, response)
            val byteCount = text.toByteArray(Charsets.UTF_8).size
            if (response.totalBytes + byteCount > AssistantResponseStream.MAX_FINAL_BYTES) {
                remove(responseId = frame.responseId)
                return null
            }
            response.buffered[frame.sequence] = text
            response.bufferedBytes += byteCount
            return snapshot(frame.responseId, response)
        }

        if (!append(response, text)) {
            remove(responseId = frame.responseId)
            return null
        }
        response.nextSequence += 1
        while (true) {
            val buffered = response.buffered.remove(response.nextSequence) ?: break
            response.bufferedBytes -= buffered.toByteArray(Charsets.UTF_8).size
            if (!append(response, buffered)) {
                remove(responseId = frame.responseId)
                return null
            }
            response.nextSequence += 1
        }
        publish()
        return snapshot(frame.responseId, response)
    }

    private fun acceptTerminal(frame: AssistantResponseFrame): ChatStreamingResponse? {
        val response = active[frame.responseId] ?: return null
        if (response.sourceEventId != frame.sourceEventId) return snapshot(frame.responseId, response)
        remove(frame.responseId)
        return null
    }

    private fun append(response: ActiveResponse, text: String): Boolean {
        val byteCount = text.toByteArray(Charsets.UTF_8).size
        if (response.totalBytes + byteCount > AssistantResponseStream.MAX_FINAL_BYTES) return false
        response.text.append(text)
        response.textBytes += byteCount
        return true
    }

    private fun remove(responseId: String) {
        active.remove(responseId)?.clear()
        publish()
    }

    private fun publish() {
        _responses.value = active.map { (responseId, response) ->
            snapshot(responseId, response)
        }
    }

    private fun snapshot(responseId: String, response: ActiveResponse): ChatStreamingResponse =
        ChatStreamingResponse(responseId, response.sourceEventId, response.text.toString())

    private class ActiveResponse(
        val sourceEventId: String,
        val text: StringBuilder = StringBuilder(),
        val buffered: MutableMap<Int, String> = HashMap(),
        var nextSequence: Int = 1,
        var textBytes: Int = 0,
        var bufferedBytes: Int = 0,
    ) {
        val totalBytes: Int get() = textBytes + bufferedBytes

        fun clear() {
            text.clear()
            buffered.clear()
            textBytes = 0
            bufferedBytes = 0
        }
    }
}
