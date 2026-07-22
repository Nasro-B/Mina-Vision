package fr.mina.gateway.messaging

interface MessagingSecretStore {
    fun put(name: String, secret: CharArray)
    fun get(name: String): CharArray?
    fun has(name: String): Boolean
    fun remove(name: String)
}

class TelegramGateway(
    private val owner: OwnerIdentity,
    private val secretStore: MessagingSecretStore? = null,
) {
    private val enabledCapabilities = mutableSetOf<String>()

    fun provisionToken(token: CharArray, locallyConfirmed: Boolean) {
        require(locallyConfirmed) { "telegram_token_confirmation_required" }
        require(token.size in 20..512) { "telegram_token_invalid" }
        val store = requireNotNull(secretStore) { "telegram_secret_store_unavailable" }
        store.put(BOT_TOKEN_SECRET_NAME, token)
        token.fill('\u0000')
    }

    fun enableCapabilities(capabilities: Set<String>, locallyConfirmed: Boolean) {
        require(locallyConfirmed) { "telegram_capability_confirmation_required" }
        require(capabilities.all { it.startsWith("mail.") || it == "home.read" || it == "home.low_risk" }) {
            "telegram_capability_forbidden"
        }
        enabledCapabilities += capabilities
    }

    fun allows(senderUserId: Long, capability: String): Boolean {
        if (!owner.ownsTelegram(senderUserId)) return false
        if (capability.startsWith("conversation.") || capability.startsWith("memory.")) return true
        return capability in enabledCapabilities
    }

    companion object {
        // Storage key name only (not a secret value) — shared so MainActivity's read-only status
        // check (secrets.has(...)) never needs its own duplicated copy of this literal.
        const val BOT_TOKEN_SECRET_NAME = "telegram_bot_token"
    }
}
