package fr.mina.gateway.protocol

import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets
import java.security.SecureRandom
import java.security.Signature
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Chiffrement bout-en-bout du chat — miroir exact de `src/devices/chat-crypto.mjs`.
 *
 * Une clé AES-256 par ÉPOQUE. L'AAD lie chaque ciphertext à son contexte (expéditeur, fil,
 * époque, dates) : déplacer un message chiffré vers un autre en-tête casse le déchiffrement
 * au lieu de passer inaperçu. Une révocation crée une nouvelle époque — l'appareil retiré ne
 * lit plus les événements FUTURS (on ne prétend pas effacer ce qu'il a déjà lu).
 */
object ChatCrypto {
    private const val TRANSFORMATION = "AES/GCM/NoPadding"
    private const val TAG_BITS = 128
    private const val NONCE_BYTES = 12
    private const val KEY_BYTES = 32
    private const val EPOCH_WRAP_PREFIX = "MINA_EPOCH_WRAP_V1"
    private const val ATTACHMENT_INFO = "mina-chat-attachment-v1"
    private val secureRandom = SecureRandom()

    private fun requireKey(key: ByteArray, label: String): ByteArray {
        require(key.size == KEY_BYTES) { "${label}_doit_faire_32_octets" }
        return key
    }

    /** Clé de pièce jointe dérivée de l'époque : une pièce compromise n'expose pas les autres. */
    fun deriveAttachmentKey(epochKey: ByteArray, attachmentId: String): ByteArray =
        hkdfSha256(
            ikm = requireKey(epochKey, "epoch_key"),
            salt = attachmentId.toByteArray(StandardCharsets.UTF_8),
            info = ATTACHMENT_INFO.toByteArray(StandardCharsets.UTF_8),
            length = KEY_BYTES,
        )

    /** HKDF-SHA256 (RFC 5869) — identique à `hkdfSync` de Node. */
    private fun hkdfSha256(ikm: ByteArray, salt: ByteArray, info: ByteArray, length: Int): ByteArray {
        val extractMac = Mac.getInstance("HmacSHA256")
        extractMac.init(SecretKeySpec(if (salt.isEmpty()) ByteArray(32) else salt, "HmacSHA256"))
        val prk = extractMac.doFinal(ikm)

        val expandMac = Mac.getInstance("HmacSHA256")
        expandMac.init(SecretKeySpec(prk, "HmacSHA256"))
        val out = ByteArrayOutputStream()
        var previous = ByteArray(0)
        var counter = 1
        while (out.size() < length) {
            expandMac.reset()
            expandMac.update(previous)
            expandMac.update(info)
            expandMac.update(counter.toByte())
            previous = expandMac.doFinal()
            out.write(previous)
            counter += 1
        }
        return out.toByteArray().copyOf(length)
    }

    private fun epochWrapAad(deviceId: String, keyEpoch: Int): ByteArray {
        val device = deviceId.toByteArray(StandardCharsets.UTF_8)
        val header = ByteBuffer.allocate(8).putInt(device.size).putInt(keyEpoch).array()
        return EPOCH_WRAP_PREFIX.toByteArray(StandardCharsets.US_ASCII) + byteArrayOf(0) + header + device
    }

    data class WrappedEpochKey(
        val keyEpoch: Int,
        val nonce: String,
        val ciphertext: String,
        val authTag: String,
    )

    fun wrapEpochKey(deviceWrapKey: ByteArray, epochKey: ByteArray, deviceId: String, keyEpoch: Int): WrappedEpochKey {
        requireKey(deviceWrapKey, "device_wrap_key")
        requireKey(epochKey, "epoch_key")
        val nonce = ByteArray(NONCE_BYTES).also { secureRandom.nextBytes(it) }
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(deviceWrapKey, "AES"), GCMParameterSpec(TAG_BITS, nonce))
        cipher.updateAAD(epochWrapAad(deviceId, keyEpoch))
        val sealed = cipher.doFinal(epochKey)
        // GCM concatène le tag à la fin : on le sépare pour rester au format du contrat Node.
        val ciphertext = sealed.copyOfRange(0, sealed.size - 16)
        val tag = sealed.copyOfRange(sealed.size - 16, sealed.size)
        val encoder = Base64.getEncoder()
        return WrappedEpochKey(
            keyEpoch = keyEpoch,
            nonce = encoder.encodeToString(nonce),
            ciphertext = encoder.encodeToString(ciphertext),
            authTag = encoder.encodeToString(tag),
        )
    }

    fun unwrapEpochKey(deviceWrapKey: ByteArray, wrapped: WrappedEpochKey, deviceId: String, keyEpoch: Int): ByteArray {
        requireKey(deviceWrapKey, "device_wrap_key")
        val decoder = Base64.getDecoder()
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(
            Cipher.DECRYPT_MODE,
            SecretKeySpec(deviceWrapKey, "AES"),
            GCMParameterSpec(TAG_BITS, decoder.decode(wrapped.nonce)),
        )
        cipher.updateAAD(epochWrapAad(deviceId, keyEpoch))
        return cipher.doFinal(decoder.decode(wrapped.ciphertext) + decoder.decode(wrapped.authTag))
    }

    /**
     * Vérifie la signature PUIS déchiffre — jamais l'inverse : déchiffrer un contenu non
     * authentifié reviendrait à traiter des octets d'origine inconnue.
     */
    fun verifyAndDecrypt(event: ChatEvent, epochKey: ByteArray, verifyPublicKey: java.security.PublicKey): String {
        requireKey(epochKey, "epoch_key")
        val decoder = Base64.getDecoder()

        val verifier = Signature.getInstance("SHA256withECDSA")
        verifier.initVerify(verifyPublicKey)
        verifier.update(ChatBinaryCodec.encodeSignatureInput(event.copy(signature = "")))
        require(verifier.verify(decoder.decode(event.signature))) { "chat_signature_invalide" }

        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(
            Cipher.DECRYPT_MODE,
            SecretKeySpec(epochKey, "AES"),
            GCMParameterSpec(TAG_BITS, decoder.decode(event.nonce)),
        )
        cipher.updateAAD(ChatBinaryCodec.encodeHeader(event))
        return try {
            String(
                cipher.doFinal(decoder.decode(event.payloadCiphertext) + decoder.decode(event.authTag)),
                StandardCharsets.UTF_8,
            )
        } catch (error: javax.crypto.AEADBadTagException) {
            // Tag invalide OU contexte modifié : dans les deux cas, contenu non fiable.
            throw IllegalStateException("chat_dechiffrement_impossible", error)
        }
    }

    fun randomKey(): ByteArray = ByteArray(KEY_BYTES).also { secureRandom.nextBytes(it) }
}
