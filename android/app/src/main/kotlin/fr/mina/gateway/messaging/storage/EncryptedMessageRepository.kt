package fr.mina.gateway.messaging.storage

import fr.mina.gateway.messaging.TelegramUpdate
import fr.mina.gateway.messaging.PendingGatewayMessage

class EncryptedMessageRepository(
    private val dao: MessagingMessageDao,
    private val cipher: MessagingFieldCipher,
) {
    fun storeInboundSms(sender: String, body: String, sentAtMs: Long): Boolean {
        require(sender.isNotBlank() && sender.length <= 128) { "sms_sender_invalid" }
        require(body.isNotEmpty() && body.length <= 4096) { "sms_body_invalid" }
        require(sentAtMs > 0) { "sms_timestamp_invalid" }
        return store("sms", "inbound", sender, body, sentAtMs, "sms|$sender|$sentAtMs|$body", "received").inserted
    }

    fun storeInboundTelegram(update: TelegramUpdate): Boolean {
        val body = update.text ?: "voice:${requireNotNull(update.voiceFileId)}"
        val sender = "${update.senderUserId}:${update.chatId}"
        return store(
            "telegram",
            "inbound",
            sender,
            body,
            update.sentAtMs,
            "telegram|${update.updateId}|$sender|$body",
            "received",
        ).inserted
    }

    fun storeOutboundSms(commandId: String, recipientE164: String, body: String): StoredMessage {
        require(commandId.matches(Regex("^cmd-[a-f0-9]{32}$"))) { "sms_command_id_invalid" }
        require(recipientE164.matches(Regex("^\\+[1-9][0-9]{7,14}$"))) { "sms_recipient_invalid" }
        require(body.isNotBlank() && body.length <= 1600) { "sms_body_invalid" }
        return store(
            "sms",
            "outbound",
            recipientE164,
            body,
            System.currentTimeMillis(),
            "sms-out|$commandId",
            "queued",
        )
    }

    fun updateState(dedupeIndex: String, state: String) {
        require(state in setOf("queued", "failed", "accepted_by_provider")) { "message_state_invalid" }
        dao.updateState(dedupeIndex, state)
    }

    fun pending(limit: Int): List<PendingGatewayMessage> {
        require(limit in 1..50) { "message_pull_limit_invalid" }
        return dao.byState("received", limit).map { row ->
            val sender = cipher.decrypt("message-sender:${row.dedupeIndex}", row.senderCiphertext)
            val body = cipher.decrypt("message-body:${row.dedupeIndex}", row.bodyCiphertext)
            try {
                PendingGatewayMessage(
                    row.dedupeIndex,
                    row.channel,
                    sender.concatToString(),
                    body.concatToString(),
                    row.sourceTimestampMs,
                )
            } finally {
                sender.fill('\u0000')
                body.fill('\u0000')
            }
        }
    }

    fun acknowledge(messageIds: List<String>): Int {
        require(messageIds.isNotEmpty() && messageIds.size <= 50) { "message_ack_ids_invalid" }
        require(messageIds.all { it.matches(Regex("^[A-Za-z0-9+/=_:-]{1,160}$")) }) { "message_ack_id_invalid" }
        return dao.acknowledge(messageIds.distinct())
    }

    private fun store(
        channel: String,
        direction: String,
        sender: String,
        body: String,
        sentAtMs: Long,
        dedupeMaterial: String,
        state: String,
    ): StoredMessage {
        val dedupeIndex = cipher.blindIndex(dedupeMaterial)
        val senderChars = sender.toCharArray()
        val bodyChars = body.toCharArray()
        val inserted = dao.insert(
            EncryptedMessageEntity(
                dedupeIndex,
                channel,
                direction,
                cipher.encrypt("message-sender:$dedupeIndex", senderChars),
                cipher.encrypt("message-body:$dedupeIndex", bodyChars),
                sentAtMs,
                System.currentTimeMillis(),
                state,
            ),
        )
        senderChars.fill('\u0000')
        bodyChars.fill('\u0000')
        return StoredMessage(dedupeIndex, inserted != -1L)
    }
}

data class StoredMessage(val dedupeIndex: String, val inserted: Boolean)
