package fr.mina.gateway.messaging.storage

import fr.mina.gateway.messaging.MessagingSecretStore
import fr.mina.gateway.messaging.TelegramOffsetStore

class EncryptedTelegramOffsetStore(private val secrets: MessagingSecretStore) : TelegramOffsetStore {
    override fun load(): Long {
        val value = secrets.get(KEY) ?: return 0L
        return try {
            value.concatToString().toLongOrNull()?.coerceAtLeast(0L) ?: 0L
        } finally {
            value.fill('\u0000')
        }
    }

    override fun save(nextOffset: Long) {
        require(nextOffset >= 0) { "telegram_offset_invalid" }
        secrets.put(KEY, nextOffset.toString().toCharArray())
    }

    private companion object {
        const val KEY = "telegram_update_offset"
    }
}
