package fr.mina.gateway.messaging

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Files

class MessagePullFileProcessorTest {
    @Test
    fun returnsPendingMessagesThenAcknowledgesOpaqueIds() {
        val root = Files.createTempDirectory("mina-message-pull").toFile()
        val commands = root.resolve("message-commands").apply { mkdirs() }
        val source = FakeMessageQueue()
        val pullId = "pull-0123456789abcdef0123456789abcdef"
        commands.resolve("$pullId.json").writeText(
            """{"version":1,"id":"$pullId","action":"messages.pull","limit":10,"createdAtMs":1000,"expiresAtMs":61000}""",
        )
        val processor = MessagePullFileProcessor(root, source, now = { 2_000L })

        assertEquals(1, processor.processPending())
        val pull = JSONObject(root.resolve("message-receipts/$pullId.json").readText())
        assertEquals("ok", pull.getString("state"))
        assertEquals("Bonjour Mina", pull.getJSONArray("messages").getJSONObject(0).getString("body"))
        assertFalse(commands.resolve("$pullId.json").exists())

        val ackId = "pull-fedcba9876543210fedcba9876543210"
        commands.resolve("$ackId.json").writeText(
            """{"version":1,"id":"$ackId","action":"messages.ack","messageIds":["opaque-1"],"createdAtMs":1000,"expiresAtMs":61000}""",
        )
        assertEquals(1, processor.processPending())
        assertEquals(listOf("opaque-1"), source.acked)
        assertTrue(JSONObject(root.resolve("message-receipts/$ackId.json").readText()).getInt("acked") == 1)
    }

    @Test
    fun sendsTelegramReplyOnlyThroughTheBoundedOwnerSender() {
        val root = Files.createTempDirectory("mina-telegram-send").toFile()
        val commands = root.resolve("message-commands").apply { mkdirs() }
        val commandId = "msg-0123456789abcdef0123456789abcdef"
        val sender = FakeTelegramReplySender()
        commands.resolve("$commandId.json").writeText(
            """{"version":1,"id":"$commandId","action":"telegram.send","sourceMessageId":"opaque-1","chatId":"123456789","text":"Bonjour Nasro","createdAtMs":1000,"expiresAtMs":61000}""",
        )
        val processor = MessagePullFileProcessor(root, FakeMessageQueue(), sender, now = { 2_000L })

        assertEquals(1, processor.processPending())
        assertEquals(Triple("opaque-1", 123456789L, "Bonjour Nasro"), sender.sent.single())
        val receipt = JSONObject(root.resolve("message-receipts/$commandId.json").readText())
        assertEquals("accepted_by_provider", receipt.getString("state"))
        assertEquals("42", receipt.getString("providerMessageId"))
    }

    @Test
    fun returnsOnlyASafeTechnicalReasonWhenTelegramSendingFails() {
        val root = Files.createTempDirectory("mina-telegram-failure").toFile()
        val commands = root.resolve("message-commands").apply { mkdirs() }
        val commandId = "msg-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        commands.resolve("$commandId.json").writeText(
            """{"version":1,"id":"$commandId","action":"telegram.send","sourceMessageId":"opaque-1","chatId":"123456789","text":"Bonjour","createdAtMs":1000,"expiresAtMs":61000}""",
        )
        val processor = MessagePullFileProcessor(
            root,
            FakeMessageQueue(),
            TelegramReplySender { _, _, _ -> throw IllegalArgumentException("telegram_chat_not_owned") },
            now = { 2_000L },
        )

        processor.processPending()
        val receipt = JSONObject(root.resolve("message-receipts/$commandId.json").readText())
        assertEquals("failed", receipt.getString("state"))
        assertEquals("telegram_chat_not_owned", receipt.getString("reason"))
    }

    private class FakeTelegramReplySender : TelegramReplySender {
        val sent = mutableListOf<Triple<String, Long, String>>()
        override fun send(sourceMessageId: String, chatId: Long, text: String): Long {
            sent += Triple(sourceMessageId, chatId, text)
            return 42L
        }
    }

    private class FakeMessageQueue : MessageQueueSource {
        val acked = mutableListOf<String>()
        override fun pending(limit: Int): List<PendingGatewayMessage> = listOf(
            PendingGatewayMessage("opaque-1", "sms", "+33600000000", "Bonjour Mina", 1_700_000_000_000L),
        ).take(limit)

        override fun acknowledge(messageIds: List<String>): Int {
            acked += messageIds
            return messageIds.size
        }
    }
}
