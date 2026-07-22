package fr.mina.gateway.messaging

import org.junit.Assert.assertEquals
import org.junit.Test

class TelegramUpdateParserTest {
    @Test
    fun preservesLargeNumericIdsAndParsesText() {
        val response = """
            {"ok":true,"result":[{"update_id":9007199254740993,"message":{"message_id":7,"date":1700000000,"chat":{"id":9007199254740991},"from":{"id":9007199254740992},"text":"Salut Mina"}}]}
        """.trimIndent()

        val update = TelegramUpdateParser.parseResponse(response).single()

        assertEquals(9007199254740993L, update.updateId)
        assertEquals(9007199254740992L, update.senderUserId)
        assertEquals(9007199254740991L, update.chatId)
        assertEquals("Salut Mina", update.text)
        assertEquals(1_700_000_000_000L, update.sentAtMs)
    }

    @Test
    fun ignoresChannelPostsAndMessagesWithoutSupportedContent() {
        val response = """{"ok":true,"result":[{"update_id":1,"channel_post":{"text":"x"}},{"update_id":2,"message":{"chat":{"id":1},"from":{"id":2}}}]}"""

        assertEquals(emptyList<TelegramUpdate>(), TelegramUpdateParser.parseResponse(response))
    }
}
