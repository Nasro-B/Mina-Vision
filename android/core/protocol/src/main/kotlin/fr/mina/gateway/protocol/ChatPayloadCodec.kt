package fr.mina.gateway.protocol

import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets

/**
 * Codec du PAYLOAD déchiffré du canal `mina_app` — miroir EXACT de `src/contracts/chat-payload.mjs`.
 *
 * Le texte v1 est du UTF-8 brut nu et n'est JAMAIS touché : premier octet ≠ 0x00 ⇒ texte v1. Les
 * nouveaux types (pièce jointe, chunk binaire) utilisent le format v2 auto-descriptif :
 *   [0x00][0x02][uint16 typeLen][type][uint32 metaLen][metaJson][uint32 binLen][binary]
 * Big-endian (ByteBuffer par défaut), longueurs préfixées. Vérifié par le vecteur partagé
 * tests/fixtures/protocol/mina-chat-payload-v2-vectors.json (le même fichier que le test Node).
 */
object ChatPayloadCodec {
    const val PAYLOAD_V2_VERSION = 2
    private const val MAX_TYPE_BYTES = 160
    private const val MAX_META_BYTES = 8 * 1024
    private const val MAX_BINARY_BYTES = 131_072

    val payloadTypes = setOf(
        "message.attachment.created",
        "message.voice.created",
        "media.chunk",
        "assistant.response.started",
        "assistant.response.chunk",
        "assistant.response.completed",
        "assistant.response.failed",
        // Appels : demande d'ouverture du composeur (ACTION_DIAL) — l'humain appuie lui-même.
        "call.dial.requested",
    )

    sealed interface DecodedPayload
    data class TextV1(val text: String) : DecodedPayload
    data class PayloadV2(val type: String, val metaJson: String, val binary: ByteArray) : DecodedPayload {
        override fun equals(other: Any?): Boolean =
            other is PayloadV2 && type == other.type && metaJson == other.metaJson && binary.contentEquals(other.binary)
        override fun hashCode(): Int = (type.hashCode() * 31 + metaJson.hashCode()) * 31 + binary.contentHashCode()
    }

    private fun uint16(value: Int): ByteArray = ByteBuffer.allocate(2).putShort(value.toShort()).array()
    private fun uint32(value: Int): ByteArray = ByteBuffer.allocate(4).putInt(value).array()

    fun encodeV2(type: String, metaJson: String, binary: ByteArray = ByteArray(0)): ByteArray {
        require(type in payloadTypes) { "chat_payload_type_invalide:$type" }
        val typeBytes = type.toByteArray(StandardCharsets.UTF_8)
        val metaBytes = metaJson.toByteArray(StandardCharsets.UTF_8)
        require(typeBytes.size <= MAX_TYPE_BYTES) { "chat_payload_type_trop_long" }
        require(metaBytes.size <= MAX_META_BYTES) { "chat_payload_meta_trop_longue" }
        require(binary.size <= MAX_BINARY_BYTES) { "chat_payload_binaire_trop_long" }
        val out = ByteArrayOutputStream()
        out.write(0x00)
        out.write(PAYLOAD_V2_VERSION)
        out.write(uint16(typeBytes.size)); out.write(typeBytes)
        out.write(uint32(metaBytes.size)); out.write(metaBytes)
        out.write(uint32(binary.size)); out.write(binary)
        return out.toByteArray()
    }

    fun decode(payload: ByteArray): DecodedPayload {
        if (payload.isEmpty()) return TextV1("")
        if (payload[0].toInt() and 0xff != 0x00) return TextV1(String(payload, StandardCharsets.UTF_8))
        require(payload.size >= 2 && payload[1].toInt() == PAYLOAD_V2_VERSION) { "chat_payload_version_inconnue" }
        val buffer = ByteBuffer.wrap(payload)
        buffer.position(2)

        val typeLen = buffer.short.toInt() and 0xffff
        require(typeLen in 1..MAX_TYPE_BYTES && buffer.remaining() >= typeLen) { "chat_payload_type_invalide" }
        val type = ByteArray(typeLen).also { buffer.get(it) }.toString(StandardCharsets.UTF_8)
        require(type in payloadTypes) { "chat_payload_type_invalide:$type" }

        val metaLen = buffer.int
        require(metaLen in 0..MAX_META_BYTES && buffer.remaining() >= metaLen) { "chat_payload_meta_invalide" }
        val metaJson = ByteArray(metaLen).also { buffer.get(it) }.toString(StandardCharsets.UTF_8)

        val binLen = buffer.int
        require(binLen in 0..MAX_BINARY_BYTES && buffer.remaining() == binLen) { "chat_payload_binaire_invalide" }
        val binary = ByteArray(binLen).also { buffer.get(it) }

        return PayloadV2(type, metaJson, binary)
    }
}
