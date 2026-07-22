package fr.mina.gateway.messaging

import org.json.JSONObject

data class TelegramUpdate(
    val updateId: Long,
    val senderUserId: Long,
    val chatId: Long,
    val text: String?,
    val voiceFileId: String?,
    val sentAtMs: Long,
)

object TelegramUpdateParser {
    fun parseResponse(response: String): List<TelegramUpdate> {
        require(response.length <= 2_000_000) { "telegram_response_too_large" }
        val root = JSONObject(response)
        require(root.optBoolean("ok", false)) { "telegram_api_not_ok" }
        val result = root.optJSONArray("result") ?: return emptyList()
        return buildList {
            for (index in 0 until result.length()) {
                val update = result.optJSONObject(index) ?: continue
                val updateId = update.optLong("update_id", -1L)
                val message = update.optJSONObject("message") ?: continue
                val sender = message.optJSONObject("from")?.optLong("id", -1L) ?: -1L
                val chat = message.optJSONObject("chat")?.optLong("id", 0L) ?: 0L
                val text = message.optString("text", "").takeIf { it.isNotEmpty() && it.length <= 4096 }
                val voice = message.optJSONObject("voice")?.optString("file_id", "")
                    ?.takeIf { it.isNotEmpty() && it.length <= 512 }
                val sentAtSeconds = message.optLong("date", 0L)
                if (updateId < 0 || sender <= 0 || chat == 0L || sentAtSeconds <= 0 || (text == null && voice == null)) continue
                add(TelegramUpdate(updateId, sender, chat, text, voice, sentAtSeconds * 1000L))
            }
        }
    }
}
