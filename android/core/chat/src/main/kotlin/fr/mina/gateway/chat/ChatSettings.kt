package fr.mina.gateway.chat

import android.content.Context

/**
 * Où joindre le PC. Rien n'est deviné : tant que l'appairage n'a pas fourni d'adresse,
 * [endpoint] renvoie null et l'application dit qu'aucun PC n'est appairé.
 */
class ChatSettings(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    companion object {
        private const val PREFS = "mina-chat-settings"
        private const val HOST = "pc_host"
        private const val PORT = "pc_port"
        private const val PAIRED_AT = "paired_at_ms"
        private const val PC_PUBLIC_KEY = "pc_public_key_spki"
        const val DEFAULT_PORT = 8771
    }

    fun endpoint(): String? {
        val host = prefs.getString(HOST, null)?.takeIf { it.isNotBlank() } ?: return null
        return "ws://$host:${prefs.getInt(PORT, DEFAULT_PORT)}"
    }

    fun host(): String? = prefs.getString(HOST, null)

    fun port(): Int = prefs.getInt(PORT, DEFAULT_PORT)

    /** Clé publique du PC : sans elle on ne peut pas vérifier ce qu'il envoie. */
    fun pcPublicKeySpki(): String? = prefs.getString(PC_PUBLIC_KEY, null)

    fun pairedAtMs(): Long = prefs.getLong(PAIRED_AT, 0L)

    fun isPaired(): Boolean = endpoint() != null

    fun pair(host: String, port: Int, pcPublicKeySpki: String?, atMs: Long) {
        require(host.isNotBlank()) { "chat_hote_vide" }
        require(port in 1..65_535) { "chat_port_invalide" }
        prefs.edit()
            .putString(HOST, host.trim())
            .putInt(PORT, port)
            .putString(PC_PUBLIC_KEY, pcPublicKeySpki)
            .putLong(PAIRED_AT, atMs)
            .apply()
    }

    /** Désappairage : on oublie l'adresse ET la clé du PC, pas seulement l'affichage. */
    fun unpair() = prefs.edit().clear().apply()
}
