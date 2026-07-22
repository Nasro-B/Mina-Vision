package fr.mina.gateway.messaging

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets

fun interface TelegramHttpTransport {
    fun post(path: String, body: String, connectTimeoutMs: Int, readTimeoutMs: Int): String
}

class TelegramApiClient(
    private val baseUrl: String = DEFAULT_BASE_URL,
    private val transport: TelegramHttpTransport = UrlConnectionTelegramTransport(DEFAULT_BASE_URL),
) {
    init {
        require(baseUrl == DEFAULT_BASE_URL || transport !is UrlConnectionTelegramTransport) {
            "telegram_base_url_forbidden"
        }
    }

    fun getUpdates(token: CharArray, offset: Long, timeoutSeconds: Int = 30): List<TelegramUpdate> {
        validateToken(token)
        require(offset >= 0) { "telegram_offset_invalid" }
        require(timeoutSeconds in 1..50) { "telegram_timeout_invalid" }
        val body = JSONObject()
            .put("offset", offset)
            .put("timeout", timeoutSeconds)
            .put("allowed_updates", listOf("message"))
            .toString()
        val response = transport.post(
            methodPath(token, "getUpdates"),
            body,
            CONNECT_TIMEOUT_MS,
            (timeoutSeconds + 10) * 1000,
        )
        return TelegramUpdateParser.parseResponse(response)
    }

    fun sendMessage(token: CharArray, chatId: Long, text: String): Long {
        validateToken(token)
        require(chatId != 0L) { "telegram_chat_id_invalid" }
        require(text.isNotBlank() && text.length <= 4096) { "telegram_text_invalid" }
        val body = JSONObject().put("chat_id", chatId).put("text", text).toString()
        val response = JSONObject(
            transport.post(methodPath(token, "sendMessage"), body, CONNECT_TIMEOUT_MS, READ_TIMEOUT_MS),
        )
        require(response.optBoolean("ok", false)) { "telegram_api_not_ok" }
        return response.getJSONObject("result").getLong("message_id")
    }

    private fun methodPath(token: CharArray, method: String): String =
        "/bot${token.concatToString()}/$method"

    private fun validateToken(token: CharArray) {
        require(token.size in 20..512) { "telegram_token_invalid" }
        require(token.all { it.isLetterOrDigit() || it == ':' || it == '_' || it == '-' }) {
            "telegram_token_characters_invalid"
        }
    }

    private companion object {
        const val DEFAULT_BASE_URL = "https://api.telegram.org"
        const val CONNECT_TIMEOUT_MS = 10_000
        const val READ_TIMEOUT_MS = 20_000
    }
}

private class UrlConnectionTelegramTransport(private val baseUrl: String) : TelegramHttpTransport {
    override fun post(path: String, body: String, connectTimeoutMs: Int, readTimeoutMs: Int): String {
        require(path.matches(Regex("^/bot[A-Za-z0-9:_-]{20,512}/[A-Za-z]{3,32}$"))) { "telegram_path_invalid" }
        val connection = URL(baseUrl + path).openConnection() as HttpURLConnection
        return try {
            connection.requestMethod = "POST"
            connection.connectTimeout = connectTimeoutMs
            connection.readTimeout = readTimeoutMs
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            val bytes = body.toByteArray(StandardCharsets.UTF_8)
            connection.setFixedLengthStreamingMode(bytes.size)
            connection.outputStream.use { it.write(bytes) }
            bytes.fill(0)
            val stream = if (connection.responseCode in 200..299) connection.inputStream else connection.errorStream
            val response = stream?.bufferedReader(StandardCharsets.UTF_8)?.use { it.readText() }.orEmpty()
            require(response.length <= 2_000_000) { "telegram_response_too_large" }
            response
        } finally {
            connection.disconnect()
        }
    }
}
