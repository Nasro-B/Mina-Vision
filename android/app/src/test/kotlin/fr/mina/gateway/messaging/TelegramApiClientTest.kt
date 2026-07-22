package fr.mina.gateway.messaging

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TelegramApiClientTest {
    @Test
    fun pollsWithOffsetAndSendsTextWithoutPuttingTokenInBodies() {
        val requests = mutableListOf<Pair<String, String>>()
        val transport = TelegramHttpTransport { path, body, _, _ ->
            requests += path to body
            if (path.endsWith("/getUpdates")) {
                """{"ok":true,"result":[{"update_id":11,"message":{"date":1700000000,"chat":{"id":22},"from":{"id":33},"text":"Bonjour"}}]}"""
            } else {
                """{"ok":true,"result":{"message_id":44}}"""
            }
        }
        val client = TelegramApiClient(transport = transport)
        val token = "123456789:abcdefghijklmnopqrstuvwxyz".toCharArray()

        val updates = client.getUpdates(token, offset = 10L, timeoutSeconds = 1)
        val receipt = client.sendMessage(token, chatId = 22L, text = "Réponse Mina")

        assertEquals(11L, updates.single().updateId)
        assertEquals(44L, receipt)
        assertTrue(requests[0].second.contains("\"offset\":10"))
        assertTrue(requests[1].second.contains("Réponse Mina"))
        assertTrue(requests.none { it.second.contains("123456789") })
    }
}
