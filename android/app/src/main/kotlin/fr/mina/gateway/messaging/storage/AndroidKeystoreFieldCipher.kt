package fr.mina.gateway.messaging.storage

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.nio.ByteBuffer
import java.nio.CharBuffer
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.Mac
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class AndroidKeystoreFieldCipher : MessagingFieldCipher {
    override fun blindIndex(label: String): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(hmacKey())
        return Base64.encodeToString(mac.doFinal(label.toByteArray(StandardCharsets.UTF_8)), Base64.NO_WRAP)
    }

    override fun encrypt(label: String, plaintext: CharArray): String {
        val plainBytes = encode(plaintext)
        return try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, aesKey())
            cipher.updateAAD(label.toByteArray(StandardCharsets.UTF_8))
            val encrypted = cipher.doFinal(plainBytes)
            val packed = ByteBuffer.allocate(2 + cipher.iv.size + encrypted.size)
                .put(FORMAT_VERSION)
                .put(cipher.iv.size.toByte())
                .put(cipher.iv)
                .put(encrypted)
                .array()
            Base64.encodeToString(packed, Base64.NO_WRAP)
        } finally {
            plainBytes.fill(0)
        }
    }

    override fun decrypt(label: String, ciphertext: String): CharArray {
        val packed = Base64.decode(ciphertext, Base64.NO_WRAP)
        require(packed.size > 2 && packed[0] == FORMAT_VERSION) { "messaging_ciphertext_format_invalid" }
        val ivSize = packed[1].toInt() and 0xff
        require(ivSize in 12..32 && packed.size > 2 + ivSize) { "messaging_ciphertext_iv_invalid" }
        val iv = packed.copyOfRange(2, 2 + ivSize)
        val encrypted = packed.copyOfRange(2 + ivSize, packed.size)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, aesKey(), GCMParameterSpec(128, iv))
        cipher.updateAAD(label.toByteArray(StandardCharsets.UTF_8))
        val plainBytes = cipher.doFinal(encrypted)
        return try {
            val decoded = StandardCharsets.UTF_8.decode(ByteBuffer.wrap(plainBytes))
            CharArray(decoded.remaining()).also { decoded.get(it) }
        } finally {
            plainBytes.fill(0)
        }
    }

    private fun aesKey(): SecretKey = synchronized(KEY_LOCK) {
        key(AES_ALIAS) ?: KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES,
            "AndroidKeyStore",
        ).run {
            init(
                KeyGenParameterSpec.Builder(
                    AES_ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                ).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build(),
            )
            generateKey()
        }
    }

    private fun hmacKey(): SecretKey = synchronized(KEY_LOCK) {
        key(HMAC_ALIAS) ?: KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_HMAC_SHA256,
            "AndroidKeyStore",
        ).run {
            init(
                KeyGenParameterSpec.Builder(HMAC_ALIAS, KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY)
                    .setDigests(KeyProperties.DIGEST_SHA256)
                    .build(),
            )
            generateKey()
        }
    }

    private fun key(alias: String): SecretKey? {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        return keyStore.getKey(alias, null) as? SecretKey
    }

    private fun encode(chars: CharArray): ByteArray {
        val bytes = StandardCharsets.UTF_8.newEncoder().encode(CharBuffer.wrap(chars))
        return ByteArray(bytes.remaining()).also { bytes.get(it) }
    }

    private companion object {
        const val AES_ALIAS = "mina.messaging.fields.v1"
        const val HMAC_ALIAS = "mina.messaging.index.v1"
        const val FORMAT_VERSION: Byte = 1
        private val KEY_LOCK = Any()
    }
}
