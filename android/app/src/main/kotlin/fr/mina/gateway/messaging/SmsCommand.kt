package fr.mina.gateway.messaging

import org.json.JSONObject

data class SmsCommand(
    val id: String,
    val sourceMessageId: String,
    val recipientE164: String,
    val text: String,
    val createdAtMs: Long,
    val expiresAtMs: Long,
)

object SmsCommandParser {
    private val commandId = Regex("^cmd-[a-f0-9]{32}$")
    private val sourceId = Regex("^[A-Za-z0-9._:-]{1,160}$")
    private val e164 = Regex("^\\+[1-9][0-9]{7,14}$")

    fun parse(raw: String, nowMs: Long = System.currentTimeMillis()): SmsCommand {
        require(raw.toByteArray().size <= 16 * 1024) { "sms_command_too_large" }
        val value = JSONObject(raw)
        require(value.length() == 9) { "sms_command_fields_invalid" }
        require(value.optInt("version", -1) == 1 && value.optString("action") == "sms.send") {
            "sms_command_action_invalid"
        }
        require(value.optBoolean("confirmed", false)) { "sms_command_confirmation_required" }
        val id = value.optString("id")
        val sourceMessageId = value.optString("sourceMessageId")
        val recipient = value.optString("recipientE164")
        val text = value.optString("text")
        val createdAt = value.optLong("createdAtMs", -1L)
        val expiresAt = value.optLong("expiresAtMs", -1L)
        require(commandId.matches(id) && sourceId.matches(sourceMessageId)) { "sms_command_identity_invalid" }
        require(e164.matches(recipient)) { "sms_command_recipient_invalid" }
        require(text.isNotBlank() && text.length <= 1600 && !text.contains('\u0000')) { "sms_command_text_invalid" }
        require(createdAt > 0 && createdAt <= nowMs + 5_000L) { "sms_command_created_at_invalid" }
        require(expiresAt > nowMs && expiresAt - createdAt in 1..60_000L) { "sms_command_expired" }
        return SmsCommand(id, sourceMessageId, recipient, text, createdAt, expiresAt)
    }
}
