package fr.mina.gateway.messaging

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.nio.charset.StandardCharsets

data class PendingGatewayMessage(
    val id: String,
    val channel: String,
    val sender: String,
    val body: String,
    val sentAtMs: Long,
)

interface MessageQueueSource {
    fun pending(limit: Int): List<PendingGatewayMessage>
    fun acknowledge(messageIds: List<String>): Int
}

fun interface TelegramReplySender {
    fun send(sourceMessageId: String, chatId: Long, text: String): Long
}

class MessagePullFileProcessor(
    root: File,
    private val source: MessageQueueSource,
    private val telegramReplySender: TelegramReplySender? = null,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val commands = root.resolve("message-commands").apply { mkdirs() }
    private val receipts = root.resolve("message-receipts").apply { mkdirs() }

    fun processPending(): Int {
        cleanupExpiredReceipts()
        val files = commands.listFiles { file -> file.isFile && file.name.matches(COMMAND_FILE) }
            ?.sortedBy { it.name }
            ?.take(20)
            .orEmpty()
        files.forEach(::process)
        return files.size
    }

    private fun process(file: File) {
        val id = file.name.removeSuffix(".json")
        val receipt = try {
            val bytes = file.readBytes()
            require(bytes.size <= 16 * 1024) { "message_command_too_large" }
            try {
                val raw = String(bytes, StandardCharsets.UTF_8)
                val value = JSONObject(raw)
                when (value.optString("action")) {
                    "messages.pull" -> pull(parsePull(value))
                    "messages.ack" -> ack(parseAck(value))
                    "telegram.send" -> sendTelegram(parseTelegramSend(value))
                    else -> error("message_command_action_invalid")
                }
            } finally {
                bytes.fill(0)
            }
        } catch (error: Exception) {
            JSONObject().put("version", 1).put("id", id).put("state", "failed").put("reason", safeFailureReason(error))
        }
        receipt.put("expiresAtMs", now() + RECEIPT_TTL_MS)
        val temporary = receipts.resolve("$id.json.tmp")
        temporary.writeText(receipt.toString(), StandardCharsets.UTF_8)
        val target = receipts.resolve("$id.json")
        if (target.exists()) check(target.delete()) { "message_receipt_replace_failed" }
        check(temporary.renameTo(target)) { "message_receipt_commit_failed" }
        file.delete()
    }

    private fun pull(command: PullCommand): JSONObject {
        val messages = JSONArray()
        source.pending(command.limit).forEach { message ->
            require(message.id.matches(MESSAGE_ID) && message.channel in setOf("sms", "telegram")) { "pending_message_invalid" }
            require(message.sender.length in 1..160 && message.body.length in 1..4096 && message.sentAtMs > 0) {
                "pending_message_payload_invalid"
            }
            messages.put(JSONObject().apply {
                put("id", message.id)
                put("channel", message.channel)
                put("sender", message.sender)
                put("body", message.body)
                put("sentAtMs", message.sentAtMs)
            })
        }
        return JSONObject().put("version", 1).put("id", command.id).put("state", "ok").put("messages", messages)
    }

    private fun ack(command: AckCommand): JSONObject = JSONObject()
        .put("version", 1)
        .put("id", command.id)
        .put("state", "ok")
        .put("acked", source.acknowledge(command.messageIds))

    private fun sendTelegram(command: TelegramSendCommand): JSONObject {
        val sender = requireNotNull(telegramReplySender) { "telegram_reply_unavailable" }
        val providerMessageId = sender.send(command.sourceMessageId, command.chatId, command.text)
        require(providerMessageId > 0) { "telegram_provider_message_id_invalid" }
        return JSONObject()
            .put("version", 1)
            .put("id", command.id)
            .put("state", "accepted_by_provider")
            .put("providerMessageId", providerMessageId.toString())
    }

    private fun parsePull(value: JSONObject): PullCommand {
        require(value.length() == 6) { "message_pull_fields_invalid" }
        val common = parseCommon(value)
        val limit = value.optInt("limit", 0)
        require(limit in 1..50) { "message_pull_limit_invalid" }
        return PullCommand(common.id, limit)
    }

    private fun parseAck(value: JSONObject): AckCommand {
        require(value.length() == 6) { "message_ack_fields_invalid" }
        val common = parseCommon(value)
        val array = value.optJSONArray("messageIds") ?: error("message_ack_ids_invalid")
        require(array.length() in 1..50) { "message_ack_ids_invalid" }
        val ids = List(array.length()) { index -> array.getString(index) }
        require(ids.all { it.matches(MESSAGE_ID) }) { "message_ack_id_invalid" }
        return AckCommand(common.id, ids.distinct())
    }

    private fun parseTelegramSend(value: JSONObject): TelegramSendCommand {
        require(value.length() == 8) { "telegram_send_fields_invalid" }
        val common = parseCommon(value)
        val sourceMessageId = value.optString("sourceMessageId")
        val chatId = value.optString("chatId").toLongOrNull()
        val text = value.optString("text")
        require(sourceMessageId.matches(MESSAGE_ID)) { "telegram_source_message_id_invalid" }
        require(chatId != null && chatId > 0) { "telegram_chat_id_invalid" }
        require(text.isNotBlank() && text.length <= 4096 && !text.contains('\u0000')) { "telegram_text_invalid" }
        return TelegramSendCommand(common.id, sourceMessageId, chatId, text)
    }

    private fun parseCommon(value: JSONObject): CommonCommand {
        require(value.optInt("version", -1) == 1) { "message_command_version_invalid" }
        val id = value.optString("id")
        val createdAt = value.optLong("createdAtMs", -1L)
        val expiresAt = value.optLong("expiresAtMs", -1L)
        val current = now()
        require(id.matches(COMMAND_ID)) { "message_command_id_invalid" }
        require(createdAt > 0 && createdAt <= current + 5_000L && expiresAt > current && expiresAt - createdAt in 1..60_000L) {
            "message_command_expired"
        }
        return CommonCommand(id)
    }

    private fun cleanupExpiredReceipts() {
        val threshold = now() - RECEIPT_TTL_MS
        receipts.listFiles { file -> file.isFile && file.lastModified() < threshold }?.forEach { it.delete() }
    }

    private fun safeFailureReason(error: Exception): String = error.message
        ?.takeIf { it.matches(SAFE_FAILURE_REASON) }
        ?: "command_rejected"

    private data class CommonCommand(val id: String)
    private data class PullCommand(val id: String, val limit: Int)
    private data class AckCommand(val id: String, val messageIds: List<String>)
    private data class TelegramSendCommand(
        val id: String,
        val sourceMessageId: String,
        val chatId: Long,
        val text: String,
    )

    private companion object {
        val COMMAND_ID = Regex("^(?:pull|msg)-[a-f0-9]{32}$")
        val COMMAND_FILE = Regex("^(?:pull|msg)-[a-f0-9]{32}\\.json$")
        val MESSAGE_ID = Regex("^[A-Za-z0-9+/=_:-]{1,160}$")
        val SAFE_FAILURE_REASON = Regex("^[a-z][a-z0-9_]{2,80}$")
        const val RECEIPT_TTL_MS = 60_000L
    }
}
