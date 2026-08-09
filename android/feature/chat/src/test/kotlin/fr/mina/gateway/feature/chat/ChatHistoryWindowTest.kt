package fr.mina.gateway.feature.chat

import fr.mina.gateway.chat.ChatMessage
import fr.mina.gateway.chat.ChatMessagePage
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatHistoryWindowTest {
    @Test
    fun `les pages anciennes glissent sans depasser 200 objets dechiffres`() = runTest {
        val history = ChatHistoryWindow()
        history.acceptRecent(page(202..251, hasOlder = true))

        repeat(4) { history.loadOlder(::olderPage) }

        assertEquals(200, history.state.value.messages.size)
        assertEquals("message-2", history.state.value.messages.first().text)
        assertEquals("message-201", history.state.value.messages.last().text)
        assertTrue(history.state.value.hasOlder)
        assertTrue(history.state.value.lastChangeWasOlder)

        history.loadOlder(::olderPage)

        assertEquals(200, history.state.value.messages.size)
        assertEquals("message-1", history.state.value.messages.first().text)
        assertEquals("message-200", history.state.value.messages.last().text)
        assertFalse(history.state.value.hasOlder)
    }

    @Test
    fun `un nouveau message conserve les pages visibles sans doublon`() = runTest {
        val history = ChatHistoryWindow()
        history.acceptRecent(page(102..151, hasOlder = true))
        history.loadOlder(::olderPage)

        history.acceptRecent(page(103..152, hasOlder = true))

        assertEquals((52..152).map { "message-$it" }, history.state.value.messages.map { it.text })
        assertTrue(history.state.value.hasOlder)
        assertFalse(history.state.value.lastChangeWasOlder)
    }

    @Test
    fun `une seconde demande pendant le chargement est ignoree`() = runTest {
        val history = ChatHistoryWindow()
        history.acceptRecent(page(102..151, hasOlder = true))
        val result = CompletableDeferred<ChatMessagePage>()
        var calls = 0
        val first = launch {
            history.loadOlder {
                calls += 1
                result.await()
            }
        }
        runCurrent()

        history.loadOlder { error("la seconde demande ne doit pas charger") }

        assertEquals(1, calls)
        assertTrue(history.state.value.loadingOlder)
        result.complete(page(52..101, hasOlder = true))
        first.join()
        assertFalse(history.state.value.loadingOlder)
    }

    private fun olderPage(before: ChatMessage): ChatMessagePage = when (before.text) {
        "message-202" -> page(152..201, hasOlder = true)
        "message-152" -> page(102..151, hasOlder = true)
        "message-102" -> page(52..101, hasOlder = true)
        "message-52" -> page(2..51, hasOlder = true)
        "message-2" -> page(1..1, hasOlder = false)
        else -> error("curseur inattendu: ${before.text}")
    }

    private fun page(range: IntRange, hasOlder: Boolean): ChatMessagePage = ChatMessagePage(
        messages = range.map(::message),
        hasOlder = hasOlder,
    )

    private fun message(index: Int): ChatMessage = ChatMessage(
        eventId = "event-$index",
        threadId = MAIN_THREAD_ID,
        text = "message-$index",
        fromAssistant = false,
        createdAtMs = index.toLong(),
        deliveryState = "completed",
    )
}
