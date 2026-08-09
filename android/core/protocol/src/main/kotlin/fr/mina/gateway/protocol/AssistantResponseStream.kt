package fr.mina.gateway.protocol

import org.json.JSONObject
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets

data class AssistantResponseFrame(
    val type: String,
    val responseId: String,
    val sourceEventId: String,
    val sequence: Int,
    val text: String?,
    val code: String?,
)

/**
 * Contrat des payloads v2 de réponse progressive — miroir de
 * `src/contracts/assistant-response-stream.mjs` côté PC.
 */
object AssistantResponseStream {
    const val MAX_SEQUENCE = 999
    const val MAX_CHUNK_BYTES = 8 * 1024
    const val MAX_FINAL_BYTES = 32 * 1024

    val types = setOf(
        "assistant.response.started",
        "assistant.response.chunk",
        "assistant.response.completed",
        "assistant.response.failed",
    )
    val failedCodes = setOf(
        "generation_cancelled",
        "generation_failed",
        "provider_timeout",
        "provider_unavailable",
    )

    private val ulidPattern = Regex("^[0-9A-HJKMNP-TV-Z]{26}$")

    fun encodeStarted(
        responseId: String,
        sourceEventId: String,
        text: String? = null,
        code: String? = null,
    ): ByteArray = encode("assistant.response.started", responseId, sourceEventId, 0, text, code)

    fun encodeChunk(responseId: String, sourceEventId: String, sequence: Int, text: String): ByteArray =
        encode("assistant.response.chunk", responseId, sourceEventId, sequence, text, null)

    fun encodeCompleted(responseId: String, sourceEventId: String, sequence: Int, text: String): ByteArray =
        encode("assistant.response.completed", responseId, sourceEventId, sequence, text, null)

    fun encodeFailed(responseId: String, sourceEventId: String, sequence: Int, code: String): ByteArray =
        encode("assistant.response.failed", responseId, sourceEventId, sequence, null, code)

    fun decode(payload: ChatPayloadCodec.PayloadV2): AssistantResponseFrame {
        require(payload.type in types) { "assistant_response_payload_invalid" }
        val meta = decodeMeta(payload.type, payload.metaJson)
        validateFrame(payload.type, meta.responseId, meta.sourceEventId, meta.sequence, payload.binary, meta.code)
        val text = if (payload.binary.isEmpty()) null else decodeUtf8(payload.binary, bodyError(payload.type))
        return AssistantResponseFrame(payload.type, meta.responseId, meta.sourceEventId, meta.sequence, text, meta.code)
    }

    private fun encode(
        type: String,
        responseId: String,
        sourceEventId: String,
        sequence: Int,
        text: String?,
        code: String?,
    ): ByteArray {
        require(type in types) { "assistant_response_type_invalid" }
        val body = encodeBody(type, text)
        validateFrame(type, responseId, sourceEventId, sequence, body, code)
        val meta = JSONObject()
            .put("responseId", responseId)
            .put("sourceEventId", sourceEventId)
            .put("sequence", sequence)
        if (code != null) meta.put("code", code)
        return ChatPayloadCodec.encodeV2(type, meta.toString(), body)
    }

    private fun encodeBody(type: String, text: String?): ByteArray {
        if (type == "assistant.response.started" || type == "assistant.response.failed") {
            require(text == null) { bodyError(type) }
            return ByteArray(0)
        }
        return encodeUtf8(text, bodyError(type))
    }

    private fun encodeUtf8(text: String?, error: String): ByteArray {
        require(text != null) { error }
        val bytes = text.toByteArray(StandardCharsets.UTF_8)
        require(decodeUtf8(bytes, error) == text) { error }
        return bytes
    }

    private fun decodeUtf8(bytes: ByteArray, error: String): String = try {
        StandardCharsets.UTF_8.newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT)
            .decode(ByteBuffer.wrap(bytes))
            .toString()
    } catch (_: CharacterCodingException) {
        throw IllegalArgumentException(error)
    }

    private fun validateFrame(
        type: String,
        responseId: String,
        sourceEventId: String,
        sequence: Int,
        body: ByteArray,
        code: String?,
    ) {
        require(type in types) { "assistant_response_type_invalid" }
        require(ulidPattern.matches(responseId) && ulidPattern.matches(sourceEventId)) { "assistant_response_id_invalid" }
        require(sequence in 0..MAX_SEQUENCE) { "assistant_response_sequence_invalid" }

        when (type) {
            "assistant.response.started" ->
                require(sequence == 0 && body.isEmpty() && code == null) { "assistant_response_started_body_invalid" }
            "assistant.response.chunk" -> {
                require(sequence >= 1) { "assistant_response_sequence_invalid" }
                require(body.isNotEmpty() && body.size <= MAX_CHUNK_BYTES && code == null) {
                    "assistant_response_chunk_body_invalid"
                }
            }
            "assistant.response.completed" -> {
                require(sequence >= 1) { "assistant_response_sequence_invalid" }
                require(body.isNotEmpty() && body.size <= MAX_FINAL_BYTES && code == null) {
                    "assistant_response_completed_body_invalid"
                }
            }
            "assistant.response.failed" -> {
                require(sequence >= 1) { "assistant_response_sequence_invalid" }
                require(body.isEmpty()) { "assistant_response_failed_body_invalid" }
                require(code in failedCodes) { "assistant_response_code_invalid" }
            }
        }
    }

    private data class ResponseMeta(
        val responseId: String,
        val sourceEventId: String,
        val sequence: Int,
        val code: String?,
    )

    private fun decodeMeta(type: String, metaJson: String): ResponseMeta {
        val json = try {
            JSONObject(metaJson)
        } catch (_: Exception) {
            throw IllegalArgumentException("assistant_response_meta_invalid")
        }
        val expected = if (type == "assistant.response.failed") {
            setOf("responseId", "sourceEventId", "sequence", "code")
        } else {
            setOf("responseId", "sourceEventId", "sequence")
        }
        require(json.keys().asSequence().toSet() == expected) { "assistant_response_meta_invalid" }
        val responseId = json.opt("responseId") as? String ?: throw IllegalArgumentException("assistant_response_meta_invalid")
        val sourceEventId = json.opt("sourceEventId") as? String ?: throw IllegalArgumentException("assistant_response_meta_invalid")
        val sequence = json.opt("sequence") as? Int ?: throw IllegalArgumentException("assistant_response_meta_invalid")
        val code = if (type == "assistant.response.failed") {
            json.opt("code") as? String ?: throw IllegalArgumentException("assistant_response_meta_invalid")
        } else {
            null
        }
        return ResponseMeta(responseId, sourceEventId, sequence, code)
    }

    private fun bodyError(type: String): String = "assistant_response_${type.substringAfterLast('.')}_body_invalid"
}
