package fr.mina.gateway.chat

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Coffre des clés d'époque du chat.
 *
 * La clé d'époque est un secret de 32 octets qui doit sortir en clair EN MÉMOIRE pour chiffrer
 * et déchiffrer les messages ; le Keystore Android ne laisse jamais sortir ses propres clés, on
 * ne peut donc pas l'y ranger directement. On fait l'inverse : le Keystore détient une clé de
 * protection non exportable, et le coffre stocke la clé d'époque ENVELOPPÉE par elle. Un vol du
 * fichier de préférences donne un blob inutilisable — il faut le matériel de l'appareil.
 *
 * Chaque époque garde sa clé : révoquer un appareil crée l'époque suivante sans rendre illisible
 * l'historique déjà écrit.
 */
class ChatKeyVault(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    companion object {
        private const val PREFS = "mina-chat-vault"
        private const val KEYSTORE = "AndroidKeyStore"
        private const val PROTECTION_ALIAS = "mina_chat_epoch_protection_v1"
        private const val CURRENT_EPOCH = "current_epoch"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val TAG_BITS = 128
        const val KEY_BYTES = 32
    }

    /** Clé de protection du Keystore — créée à la première utilisation, jamais exportable. */
    private fun protectionKey(): SecretKey {
        val keyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (keyStore.getEntry(PROTECTION_ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(
                PROTECTION_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    /** Époque courante — 1 tant qu'aucune rotation n'a eu lieu. */
    fun currentEpoch(): Int = prefs.getInt(CURRENT_EPOCH, 1)

    /**
     * Renvoie la clé de l'époque demandée, ou null si elle n'a pas été reçue du PC.
     *
     * Le téléphone ne FABRIQUE jamais une clé d'époque : le PC en est l'autorité et la transmet
     * enveloppée à l'appairage. Inventer une clé locale donnerait des messages que le PC ne
     * pourrait pas lire, tout en ayant l'air de fonctionner.
     */
    fun epochKey(epoch: Int): ByteArray? = prefs.getString(epochEntry(epoch), null)?.let { unwrap(it) }

    /** Installe une clé d'époque reçue du PC et en fait l'époque courante si elle est plus récente. */
    fun installEpochKey(epoch: Int, key: ByteArray) {
        require(key.size == KEY_BYTES) { "chat_cle_epoque_taille_invalide" }
        val editor = prefs.edit().putString(epochEntry(epoch), wrap(key))
        if (epoch >= currentEpoch()) editor.putInt(CURRENT_EPOCH, epoch)
        editor.apply()
    }

    fun hasKeyFor(epoch: Int): Boolean = prefs.contains(epochEntry(epoch))

    /** Efface tout le matériel de clés — l'historique chiffré devient définitivement illisible. */
    fun wipe() {
        prefs.edit().clear().apply()
        runCatching { KeyStore.getInstance(KEYSTORE).apply { load(null) }.deleteEntry(PROTECTION_ALIAS) }
    }

    private fun epochEntry(epoch: Int) = "epoch_$epoch"

    private fun wrap(key: ByteArray): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, protectionKey())
        val sealed = cipher.doFinal(key)
        val encoder = Base64.getEncoder()
        return "${encoder.encodeToString(cipher.iv)}:${encoder.encodeToString(sealed)}"
    }

    private fun unwrap(blob: String): ByteArray? {
        val parts = blob.split(':')
        if (parts.size != 2) return null
        return runCatching {
            val decoder = Base64.getDecoder()
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(
                Cipher.DECRYPT_MODE,
                protectionKey(),
                GCMParameterSpec(TAG_BITS, decoder.decode(parts[0])),
            )
            cipher.doFinal(decoder.decode(parts[1]))
        }.getOrNull()
    }
}
