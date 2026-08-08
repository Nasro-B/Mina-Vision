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
    private const val MAX_CHUNK_COUNT = 4_096
    private val MEDIA_ID = Regex("^[A-Za-z0-9._:-]{1,64}$")
    private val SHA256 = Regex("^[a-f0-9]{64}$")
    private val MIME_TO_TYPE = mapOf(
        "image/jpeg" to "message.attachment.created",
        "image/png" to "message.attachment.created",
        "image/webp" to "message.attachment.created",
        "audio/mp4" to "message.voice.created",
        VoicePcmFormat.MIME to "message.voice.created",
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

    fun eventTypeFor(mime: String): String =
        MIME_TO_TYPE[mime] ?: throw IllegalArgumentException("media_mime_refuse:$mime")

    fun encodeMeta(
        mediaId: String,
        mime: String,
        sizeBytes: Int,
        sha256: String,
        chunkCount: Int,
        chunkBytes: Int,
        extraMeta: Map<String, Any> = emptyMap(),
    ): ByteArray {
        val eventType = eventTypeFor(mime)
        val maxBytes = maxBytesFor(mime)
        val maxChunkBytes = maxChunkBytesFor(mime)
        require(MEDIA_ID.matches(mediaId)) { "media_id_invalide" }
        require(sizeBytes in 1..maxBytes) { "media_taille_invalide" }
        require(SHA256.matches(sha256)) { "media_digest_invalide" }
        require(chunkBytes in 1..maxChunkBytes) { "media_chunk_bytes_invalide" }
        require(chunkCount in 1..MAX_CHUNK_COUNT) { "media_chunk_count_invalide" }
        val theoreticalBytes = chunkCount.toLong() * chunkBytes.toLong()
        val theoreticalLimit = if (VoicePcmFormat.isCanonicalMime(mime)) {
            maxBytes.toLong() + VoicePcmFormat.CHUNK_BYTES - 1
        } else {
            maxBytes.toLong()
        }
        require(theoreticalBytes <= theoreticalLimit) { "media_trop_gros" }
        require(chunkCount == (sizeBytes + chunkBytes - 1) / chunkBytes) { "media_chunk_count_invalide" }
        return ChatPayloadCodec.encodeV2(
            eventType,
            JSONObject().apply {
                put("mediaId", mediaId)
                put("mime", mime)
                put("sizeBytes", sizeBytes)
                put("sha256", sha256)
                put("chunkCount", chunkCount)
                put("chunkBytes", chunkBytes)
                for ((key, value) in extraMeta) put(key, value)
            }.toString(),
        )
    }

    fun encodeChunk(mediaId: String, index: Int, binary: ByteArray): ByteArray {
        require(MEDIA_ID.matches(mediaId)) { "media_id_invalide" }
        require(index >= 0) { "media_index_invalide" }
        require(binary.isNotEmpty() && binary.size <= CHUNK_BYTES) { "media_chunk_taille_invalide" }
        return ChatPayloadCodec.encodeV2(
            "media.chunk",
            JSONObject().apply {
                put("mediaId", mediaId)
                put("index", index)
            }.toString(),
            binary,
        )
    }

    fun chunk(bytes: ByteArray, mime: String, extraMeta: Map<String, Any> = emptyMap()): MediaPiece {
        eventTypeFor(mime)
        require(bytes.isNotEmpty()) { "media_vide" }
        val maxBytes = maxBytesFor(mime)
        val chunkBytes = maxChunkBytesFor(mime)
        require(bytes.size <= maxBytes) { "media_trop_gros" }

        val mediaId = randomMediaId()
        val chunkCount = (bytes.size + chunkBytes - 1) / chunkBytes
        val metaPayload = encodeMeta(
            mediaId = mediaId,
            mime = mime,
            sizeBytes = bytes.size,
            sha256 = sha256Hex(bytes),
            chunkCount = chunkCount,
            chunkBytes = chunkBytes,
            extraMeta = extraMeta,
        )

        val chunkPayloads = ArrayList<ByteArray>(chunkCount)
        for (index in 0 until chunkCount) {
            val from = index * chunkBytes
            val to = minOf(from + chunkBytes, bytes.size)
            val slice = bytes.copyOfRange(from, to)
            chunkPayloads.add(encodeChunk(mediaId, index, slice))
        }
        return MediaPiece(mediaId, metaPayload, chunkPayloads)
    }

    private fun maxBytesFor(mime: String): Int =
        if (VoicePcmFormat.isCanonicalMime(mime)) VoicePcmFormat.MAX_BYTES else MAX_TOTAL_BYTES

    private fun maxChunkBytesFor(mime: String): Int =
        if (VoicePcmFormat.isCanonicalMime(mime)) VoicePcmFormat.CHUNK_BYTES else CHUNK_BYTES
}
