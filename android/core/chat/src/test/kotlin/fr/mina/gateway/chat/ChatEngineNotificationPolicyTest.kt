package fr.mina.gateway.chat

import fr.mina.gateway.protocol.AssistantResponseFrame
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatEngineNotificationPolicyTest {
    @Test
    fun `notifie uniquement le final nouveau d une reponse assistant`() {
        assertTrue(shouldNotifyAssistantMessage(
            known = false,
            routingClass = "message",
            result = ChatIngestResult(assistantResponseFrame = completed()),
        ))
        assertFalse(shouldNotifyAssistantMessage(
            known = false,
            routingClass = "stream",
            result = ChatIngestResult(assistantResponseFrame = started(), isAssistantResponse = true),
        ))
        assertFalse(shouldNotifyAssistantMessage(
            known = false,
            routingClass = "message",
            result = ChatIngestResult(assistantResponseFrame = failed(), isAssistantResponse = true),
        ))
        assertFalse(shouldNotifyAssistantMessage(
            known = true,
            routingClass = "message",
            result = ChatIngestResult(assistantResponseFrame = completed(), isAssistantResponse = true),
        ))
    }

    @Test
    fun `garde la notification des messages non stream existants`() {
        assertTrue(shouldNotifyAssistantMessage(
            known = false,
            routingClass = "message",
            result = ChatIngestResult(),
        ))
        assertFalse(shouldNotifyAssistantMessage(
            known = false,
            routingClass = "stream",
            result = ChatIngestResult(),
        ))
    }

    @Test
    fun `ne rebranche jamais RTDB pour une trame assistant deja ingeree`() {
        assertTrue(shouldRouteRealtimeResponse(
            known = false,
            result = ChatIngestResult(assistantResponseFrame = started()),
        ))
        assertFalse(shouldRouteRealtimeResponse(
            known = true,
            result = ChatIngestResult(assistantResponseFrame = started()),
        ))
        assertFalse(shouldRouteRealtimeResponse(
            known = false,
            result = ChatIngestResult(),
        ))
    }

    private fun started() = AssistantResponseFrame(
        type = "assistant.response.started",
        responseId = RESPONSE_ID,
        sourceEventId = SOURCE_EVENT_ID,
        sequence = 0,
        text = null,
        code = null,
    )

    private fun completed() = AssistantResponseFrame(
        type = "assistant.response.completed",
        responseId = RESPONSE_ID,
        sourceEventId = SOURCE_EVENT_ID,
        sequence = 2,
        text = "Bonjour",
        code = null,
    )

    private fun failed() = AssistantResponseFrame(
        type = "assistant.response.failed",
        responseId = RESPONSE_ID,
        sourceEventId = SOURCE_EVENT_ID,
        sequence = 2,
        text = null,
        code = "provider_unavailable",
    )

    private companion object {
        const val RESPONSE_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV"
        const val SOURCE_EVENT_ID = "01BX5ZZKBKACTAV9WEVGEMMVRZ"
    }
}
