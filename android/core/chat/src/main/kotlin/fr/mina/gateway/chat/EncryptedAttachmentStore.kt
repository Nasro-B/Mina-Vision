package fr.mina.gateway.chat

import android.util.AtomicFile
import fr.mina.gateway.protocol.VoicePcmFormat
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Buffer de capture vocale : l'appelant ne donne jamais au stockage qu'un paquet PCM court.
 * Chaque paquet est chiffré avant toute écriture, puis le buffer de l'appelant est effacé.
 */
interface EncryptedVoiceAttachmentSink {
    fun append(buffer: ByteArray, byteCount: Int)
    fun complete(durationMs: Long): StoredVoiceAttachment
    fun discard()
}

/**
 * Capture PCM terminée, encore présente localement tant que tous les événements de l'outbox ne
 * sont pas durables. Les chemins et les octets restent internes au module chat.
 */
class StoredVoiceAttachment internal constructor(
    val mediaId: String,
    val mime: String,
    val sizeBytes: Int,
    val sha256: String,
    val chunkCount: Int,
    val chunkBytes: Int,
    val durationMs: Long,
    internal val threadId: String,
    internal val keyEpoch: Int,
    internal var deliveryEventIds: List<String>,
    internal val store: EncryptedAttachmentStore,
) {
    /** Persiste le plan une fois ; une reprise doit obligatoirement garder les mêmes ULID. */
    fun withDeliveryPlan(eventIds: List<String>): StoredVoiceAttachment = store.withDeliveryPlan(this, eventIds)

    internal fun readChunk(index: Int): ByteArray = store.readChunk(this, index)

    internal fun deletePersistedCapture() = store.deleteCapture(this)
}

/**
 * Stockage hors Room des PCM encore en cours de capture ou de mise en outbox.
 *
 * Le répertoire ne contient que des .bin : nonce AES-GCM suivi du ciphertext+tag. Le manifeste
 * est soumis au même chiffrement ; aucun chemin persistant ne contient des octets audio clairs.
 */
class EncryptedAttachmentStore(
    private val root: File,
    private val epochKeyProvider: (Int) -> ByteArray?,
    private val currentEpoch: () -> Int,
    private val secureRandom: SecureRandom = SecureRandom(),
) {
    fun createVoiceCapture(threadId: String): EncryptedVoiceAttachmentSink {
        require(threadId.isNotBlank()) { "chat_thread_invalide" }
        ensureRoot()
        val epoch = currentEpoch()
        requireEpochKey(epoch).fill(0)
        val (mediaId, directory) = createCaptureDirectory()
        return try {
            Capture(directory, mediaId, threadId, epoch).also { capture ->
                writeManifest(capture.manifest())
            }
        } catch (error: Exception) {
            directory.deleteRecursively()
            throw error
        }
    }

    internal fun withDeliveryPlan(
        attachment: StoredVoiceAttachment,
        eventIds: List<String>,
    ): StoredVoiceAttachment {
        require(eventIds.size == attachment.chunkCount + 1) { "voice_plan_livraison_invalide" }
        require(eventIds.none { it.isBlank() }) { "voice_plan_livraison_invalide" }
        require(eventIds.distinct().size == eventIds.size) { "voice_plan_livraison_invalide" }
        if (attachment.deliveryEventIds.isNotEmpty()) {
            require(attachment.deliveryEventIds == eventIds) { "voice_plan_livraison_incoherent" }
            return attachment
        }
        val plannedIds = eventIds.toList()
        writeManifest(attachment.toManifest(deliveryEventIds = plannedIds))
        attachment.deliveryEventIds = plannedIds
        return attachment
    }

    internal fun readChunk(attachment: StoredVoiceAttachment, index: Int): ByteArray {
        require(index in 0 until attachment.chunkCount) { "voice_chunk_index_invalide" }
        val encoded = chunkFile(attachment.mediaId, index).readBytes()
        val expectedSize = if (index == attachment.chunkCount - 1) {
            attachment.sizeBytes - index * attachment.chunkBytes
        } else {
            attachment.chunkBytes
        }
        return try {
            val plaintext = decrypt(
                epoch = attachment.keyEpoch,
                mediaId = attachment.mediaId,
                part = index.toString(),
                encoded = encoded,
            )
            require(plaintext.size == expectedSize) { "voice_chunk_taille_invalide" }
            plaintext
        } finally {
            encoded.fill(0)
        }
    }

    internal fun deleteCapture(attachment: StoredVoiceAttachment) {
        deleteCaptureDirectory(attachment.mediaId)
    }

    private inner class Capture(
        private val directory: File,
        private val mediaId: String,
        private val threadId: String,
        private val keyEpoch: Int,
    ) : EncryptedVoiceAttachmentSink {
        private val digest = MessageDigest.getInstance("SHA-256")
        private var sizeBytes = 0
        private var chunkCount = 0
        private var completed = false
        private var discarded = false

        @Synchronized
        override fun append(buffer: ByteArray, byteCount: Int) {
            try {
                check(!discarded) { "voice_capture_abandonnee" }
                check(!completed) { "voice_capture_terminee" }
                require(byteCount in 1..buffer.size) { "voice_buffer_invalide" }
                require(byteCount <= VoicePcmFormat.CHUNK_BYTES) { "voice_chunk_trop_grand" }
                require(byteCount % VoicePcmFormat.BYTES_PER_SAMPLE == 0) { "voice_pcm_invalide" }
                require(sizeBytes <= VoicePcmFormat.MAX_BYTES - byteCount) { "voice_trop_gros" }

                writeEncrypted(
                    target = File(directory, chunkFileName(chunkCount)),
                    epoch = keyEpoch,
                    mediaId = mediaId,
                    part = chunkCount.toString(),
                    plaintext = buffer,
                    offset = 0,
                    length = byteCount,
                )
                digest.update(buffer, 0, byteCount)
                sizeBytes += byteCount
                chunkCount += 1
                writeManifest(manifest())
            } catch (error: Exception) {
                if (!completed && !discarded) discardInternal()
                throw error
            } finally {
                if (byteCount in 0..buffer.size) buffer.fill(0, 0, byteCount)
            }
        }

        @Synchronized
        override fun complete(durationMs: Long): StoredVoiceAttachment {
            try {
                check(!discarded) { "voice_capture_abandonnee" }
                check(!completed) { "voice_capture_terminee" }
                require(sizeBytes > 0 && chunkCount > 0) { "voice_capture_vide" }
                require(sizeBytes % VoicePcmFormat.BYTES_PER_SAMPLE == 0) { "voice_pcm_invalide" }
                require(durationMs in VoicePcmFormat.MIN_DURATION_MS..VoicePcmFormat.MAX_DURATION_MS) {
                    "voice_duree_invalide"
                }

                val attachment = StoredVoiceAttachment(
                    mediaId = mediaId,
                    mime = VoicePcmFormat.MIME,
                    sizeBytes = sizeBytes,
                    sha256 = digest.digest().toHex(),
                    chunkCount = chunkCount,
                    chunkBytes = VoicePcmFormat.CHUNK_BYTES,
                    durationMs = durationMs,
                    threadId = threadId,
                    keyEpoch = keyEpoch,
                    deliveryEventIds = emptyList(),
                    store = this@EncryptedAttachmentStore,
                )
                writeManifest(attachment.toManifest())
                completed = true
                return attachment
            } catch (error: Exception) {
                if (!completed && !discarded) discardInternal()
                throw error
            }
        }

        @Synchronized
        override fun discard() {
            if (!discarded) discardInternal()
        }

        fun manifest() = VoiceManifest(
            directory = directory,
            mediaId = mediaId,
            threadId = threadId,
            keyEpoch = keyEpoch,
            sizeBytes = sizeBytes,
            sha256 = "",
            chunkCount = chunkCount,
            chunkBytes = VoicePcmFormat.CHUNK_BYTES,
            durationMs = 0,
            completed = false,
            deliveryEventIds = emptyList(),
        )

        private fun discardInternal() {
            discarded = true
            deleteCaptureDirectory(mediaId)
        }
    }

    private data class VoiceManifest(
        val directory: File,
        val mediaId: String,
        val threadId: String,
        val keyEpoch: Int,
        val sizeBytes: Int,
        val sha256: String,
        val chunkCount: Int,
        val chunkBytes: Int,
        val durationMs: Long,
        val completed: Boolean,
        val deliveryEventIds: List<String>,
    )

    private fun StoredVoiceAttachment.toManifest(
        deliveryEventIds: List<String> = this.deliveryEventIds,
    ) = VoiceManifest(
        directory = attachmentDirectory(mediaId),
        mediaId = mediaId,
        threadId = threadId,
        keyEpoch = keyEpoch,
        sizeBytes = sizeBytes,
        sha256 = sha256,
        chunkCount = chunkCount,
        chunkBytes = chunkBytes,
        durationMs = durationMs,
        completed = true,
        deliveryEventIds = deliveryEventIds,
    )

    private fun writeManifest(manifest: VoiceManifest) {
        val plaintext = JSONObject()
            .put("version", 1)
            .put("mediaId", manifest.mediaId)
            .put("threadId", manifest.threadId)
            .put("mime", VoicePcmFormat.MIME)
            .put("keyEpoch", manifest.keyEpoch)
            .put("sizeBytes", manifest.sizeBytes)
            .put("sha256", manifest.sha256)
            .put("chunkCount", manifest.chunkCount)
            .put("chunkBytes", manifest.chunkBytes)
            .put("durationMs", manifest.durationMs)
            .put("completed", manifest.completed)
            .put("eventIds", JSONArray(manifest.deliveryEventIds))
            .toString()
            .encodeToByteArray()
        try {
            writeEncrypted(
                target = File(manifest.directory, MANIFEST_FILE),
                epoch = manifest.keyEpoch,
                mediaId = manifest.mediaId,
                part = "manifest",
                plaintext = plaintext,
                offset = 0,
                length = plaintext.size,
            )
        } finally {
            plaintext.fill(0)
        }
    }

    private fun writeEncrypted(
        target: File,
        epoch: Int,
        mediaId: String,
        part: String,
        plaintext: ByteArray,
        offset: Int,
        length: Int,
    ) {
        val encoded = encrypt(epoch, mediaId, part, plaintext, offset, length)
        try {
            writeAtomically(target, encoded)
        } finally {
            encoded.fill(0)
        }
    }

    private fun encrypt(
        epoch: Int,
        mediaId: String,
        part: String,
        plaintext: ByteArray,
        offset: Int,
        length: Int,
    ): ByteArray {
        val key = requireEpochKey(epoch)
        val nonce = ByteArray(NONCE_BYTES).also(secureRandom::nextBytes)
        val aad = aad(mediaId, part)
        var sealed: ByteArray? = null
        return try {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(TAG_BITS, nonce))
            cipher.updateAAD(aad)
            sealed = cipher.doFinal(plaintext, offset, length)
            nonce + sealed
        } finally {
            key.fill(0)
            nonce.fill(0)
            aad.fill(0)
            sealed?.fill(0)
        }
    }

    private fun decrypt(epoch: Int, mediaId: String, part: String, encoded: ByteArray): ByteArray {
        require(encoded.size > NONCE_BYTES + TAG_BYTES) { "voice_chunk_chiffre_invalide" }
        val key = requireEpochKey(epoch)
        val nonce = encoded.copyOfRange(0, NONCE_BYTES)
        val sealed = encoded.copyOfRange(NONCE_BYTES, encoded.size)
        val aad = aad(mediaId, part)
        return try {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(TAG_BITS, nonce))
            cipher.updateAAD(aad)
            cipher.doFinal(sealed)
        } finally {
            key.fill(0)
            nonce.fill(0)
            sealed.fill(0)
            aad.fill(0)
        }
    }

    private fun writeAtomically(target: File, bytes: ByteArray) {
        val atomic = AtomicFile(target)
        val output = atomic.startWrite()
        try {
            output.write(bytes)
            output.fd.sync()
            atomic.finishWrite(output)
        } catch (error: Exception) {
            atomic.failWrite(output)
            throw error
        }
    }

    private fun ensureRoot() {
        if (!root.exists() && !root.mkdirs()) throw IOException("voice_store_creation_echouee")
        require(root.isDirectory) { "voice_store_invalide" }
    }

    private fun createCaptureDirectory(): Pair<String, File> {
        repeat(3) {
            val mediaId = ByteArray(16).also(secureRandom::nextBytes).toHex()
            val directory = attachmentDirectory(mediaId)
            if (directory.mkdir()) return mediaId to directory
        }
        throw IOException("voice_capture_creation_echouee")
    }

    private fun chunkFile(mediaId: String, index: Int): File = File(attachmentDirectory(mediaId), chunkFileName(index))

    private fun chunkFileName(index: Int): String = "chunk-${index.toString().padStart(6, '0')}.bin"

    private fun attachmentDirectory(mediaId: String): File {
        require(MEDIA_ID.matches(mediaId)) { "media_id_invalide" }
        val directory = File(root, mediaId)
        val canonicalRoot = root.canonicalFile
        val canonicalDirectory = directory.canonicalFile
        require(canonicalDirectory.parentFile == canonicalRoot) { "voice_capture_chemin_invalide" }
        return directory
    }

    private fun deleteCaptureDirectory(mediaId: String) {
        attachmentDirectory(mediaId).deleteRecursively()
    }

    private fun requireEpochKey(epoch: Int): ByteArray {
        val supplied = epochKeyProvider(epoch) ?: throw IllegalStateException("chat_coffre_verrouille")
        require(supplied.size == ChatKeyVault.KEY_BYTES) { "chat_cle_epoque_taille_invalide" }
        return supplied.copyOf()
    }

    private fun aad(mediaId: String, part: String): ByteArray = "$AAD_PREFIX|$mediaId|$part".encodeToByteArray()

    private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }

    companion object {
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val TAG_BITS = 128
        private const val NONCE_BYTES = 12
        private const val TAG_BYTES = 16
        private const val AAD_PREFIX = "mina-voice-v1"
        private const val MANIFEST_FILE = "manifest.bin"
        private val MEDIA_ID = Regex("^[a-f0-9]{32}$")
    }
}
