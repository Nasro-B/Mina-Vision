package fr.mina.gateway.protocol

import java.security.MessageDigest

/**
 * Réassemble un média reçu en chunks (sens PC → téléphone, W6). Miroir strict de
 * src/chat/media-assembler.mjs : bornes AVANT allocation, index dans [0, chunkCount), dernier chunk
 * de la taille exacte restante, sha256 vérifié sur le total — un octet divergent rejette TOUT le
 * média (jamais un fichier « presque bon »).
 */
object MediaAssembler {
    private const val MAX_TOTAL_BYTES = 5 * 1024 * 1024
    private const val MAX_CHUNK_BYTES = 131_072
    private const val MAX_CHUNK_COUNT = 4_096
    private val MEDIA_ID = Regex("^[A-Za-z0-9._:-]{1,64}$")
    private val ALLOWED_MIMES = setOf("image/jpeg", "image/png", "image/webp", "audio/mp4", VoicePcmFormat.MIME)

    data class Meta(
        val mediaId: String,
        val mime: String,
        val sizeBytes: Int,
        val sha256: String,
        val chunkCount: Int,
        val chunkBytes: Int,
    )

    fun parseMeta(meta: Map<String, Any?>): Meta {
        val mediaId = meta["mediaId"] as? String ?: throw IllegalArgumentException("media_id_invalide")
        if (!MEDIA_ID.matches(mediaId)) throw IllegalArgumentException("media_id_invalide")
        val mime = meta["mime"] as? String ?: throw IllegalArgumentException("media_mime_refuse")
        if (mime !in ALLOWED_MIMES) throw IllegalArgumentException("media_mime_refuse:$mime")
        val voicePcm = VoicePcmFormat.isCanonicalMime(mime)
        val maxBytes = if (voicePcm) VoicePcmFormat.MAX_BYTES else MAX_TOTAL_BYTES
        val sizeBytes = (meta["sizeBytes"] as? Number)?.toInt() ?: throw IllegalArgumentException("media_taille_invalide")
        if (sizeBytes < 1 || sizeBytes > maxBytes) throw IllegalArgumentException("media_taille_invalide")
        val sha256 = (meta["sha256"] as? String)?.lowercase() ?: throw IllegalArgumentException("media_digest_invalide")
        if (!Regex("^[a-f0-9]{64}$").matches(sha256)) throw IllegalArgumentException("media_digest_invalide")
        val chunkBytes = (meta["chunkBytes"] as? Number)?.toInt() ?: throw IllegalArgumentException("media_chunk_bytes_invalide")
        val maxChunkBytes = if (voicePcm) VoicePcmFormat.CHUNK_BYTES else MAX_CHUNK_BYTES
        if (chunkBytes < 1 || chunkBytes > maxChunkBytes) throw IllegalArgumentException("media_chunk_bytes_invalide")
        val chunkCount = (meta["chunkCount"] as? Number)?.toInt() ?: throw IllegalArgumentException("media_chunk_count_invalide")
        if (chunkCount !in 1..MAX_CHUNK_COUNT) throw IllegalArgumentException("media_chunk_count_invalide")
        val expectedCount = (sizeBytes + chunkBytes - 1) / chunkBytes
        if (chunkCount != expectedCount) throw IllegalArgumentException("media_chunk_count_invalide")
        val theoreticalBytes = chunkCount.toLong() * chunkBytes.toLong()
        val theoreticalLimit = if (voicePcm) maxBytes.toLong() + VoicePcmFormat.CHUNK_BYTES - 1 else maxBytes.toLong()
        if (theoreticalBytes > theoreticalLimit) throw IllegalArgumentException("media_trop_gros")
        return Meta(mediaId, mime, sizeBytes, sha256, chunkCount, chunkBytes)
    }

    /**
     * Assemble depuis des chunks indexés. Rejette tout si un index manque, déborde, ou si le
     * sha256 du total ne correspond pas au digest annoncé.
     */
    fun assemble(meta: Meta, chunks: Map<Int, ByteArray>): ByteArray {
        val out = ByteArray(meta.sizeBytes)
        for (index in 0 until meta.chunkCount) {
            val chunk = chunks[index] ?: throw IllegalStateException("media_chunk_manquant:$index")
            val offset = index * meta.chunkBytes
            val expected = if (index == meta.chunkCount - 1) meta.sizeBytes - offset else meta.chunkBytes
            if (chunk.size != expected) throw IllegalStateException("media_chunk_taille_invalide:$index")
            chunk.copyInto(out, offset)
        }
        val digest = MessageDigest.getInstance("SHA-256").digest(out).joinToString("") { "%02x".format(it) }
        if (digest != meta.sha256) throw IllegalStateException("media_digest_divergent")
        return out
    }
}
