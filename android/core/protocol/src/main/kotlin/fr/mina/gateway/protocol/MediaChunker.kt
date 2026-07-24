package fr.mina.gateway.protocol

import org.json.JSONObject
import java.security.MessageDigest
import java.security.SecureRandom

/**
 * Découpe un média (image recompressée / audio m4a) en un payload de métadonnées + N payloads de
 * chunks binaires, encodés en payload v2 (ChatPayloadCodec). Miroir de src/chat/media-chunker.mjs :
 * le PC réassemble avec les mêmes bornes et vérifie le sha256. 128 Kio par chunk (sous le plafond
 * ciphertext de l'enveloppe), 5 Mo max au total.
 */
object MediaChunker {
    private const val CHUNK_BYTES = 131_072
    private const val MAX_TOTAL_BYTES = 5 * 1024 * 1024
    private val MIME_TO_TYPE = mapOf(
        "image/jpeg" to "message.attachment.created",
        "image/png" to "message.attachment.created",
        "image/webp" to "message.attachment.created",
        "audio/mp4" to "message.voice.created",
    )

    data class MediaPiece(val mediaId: String, val metaPayload: ByteArray, val chunkPayloads: List<ByteArray>) {
        override fun equals(other: Any?): Boolean = this === other
        override fun hashCode(): Int = mediaId.hashCode()
    }

    private fun randomMediaId(): String {
        val bytes = ByteArray(16).also { SecureRandom().nextBytes(it) }
        return bytes.joinToString("") { "%02x".format(it) }
    }

    private fun sha256Hex(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    fun chunk(bytes: ByteArray, mime: String, extraMeta: Map<String, Any> = emptyMap()): MediaPiece {
        val eventType = MIME_TO_TYPE[mime] ?: throw IllegalArgumentException("media_mime_refuse:$mime")
        require(bytes.isNotEmpty()) { "media_vide" }
        require(bytes.size <= MAX_TOTAL_BYTES) { "media_trop_gros" }

        val mediaId = randomMediaId()
        val chunkCount = (bytes.size + CHUNK_BYTES - 1) / CHUNK_BYTES
        val meta = JSONObject().apply {
            put("mediaId", mediaId)
            put("mime", mime)
            put("sizeBytes", bytes.size)
            put("sha256", sha256Hex(bytes))
            put("chunkCount", chunkCount)
            put("chunkBytes", CHUNK_BYTES)
            for ((key, value) in extraMeta) put(key, value)
        }
        val metaPayload = ChatPayloadCodec.encodeV2(eventType, meta.toString())

        val chunkPayloads = ArrayList<ByteArray>(chunkCount)
        for (index in 0 until chunkCount) {
            val from = index * CHUNK_BYTES
            val to = minOf(from + CHUNK_BYTES, bytes.size)
            val slice = bytes.copyOfRange(from, to)
            val chunkMeta = JSONObject().apply { put("mediaId", mediaId); put("index", index) }
            chunkPayloads.add(ChatPayloadCodec.encodeV2("media.chunk", chunkMeta.toString(), slice))
        }
        return MediaPiece(mediaId, metaPayload, chunkPayloads)
    }
}
