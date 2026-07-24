package fr.mina.gateway.messaging.storage

import fr.mina.gateway.messaging.MessagingSecretStore
import fr.mina.gateway.messaging.OwnerIdentity
import org.json.JSONArray

class EncryptedOwnerIdentityStore(private val secrets: MessagingSecretStore) {
    fun save(phoneE164: String, telegramUserIds: Set<Long>, locallyConfirmed: Boolean) {
        require(locallyConfirmed) { "owner_identity_confirmation_required" }
        val identity = OwnerIdentity(phoneE164, telegramUserIds)
        secrets.put(PHONE_KEY, identity.phoneE164.toCharArray())
        secrets.put(USER_IDS_KEY, JSONArray(identity.telegramUserIds.sorted()).toString().toCharArray())
    }

    /** Efface l'identité propriétaire (numéro + IDs Telegram). Le token se retire à part. */
    fun clear() {
        secrets.remove(PHONE_KEY)
        secrets.remove(USER_IDS_KEY)
    }

    fun load(): OwnerIdentity? {
        val phone = secrets.get(PHONE_KEY) ?: return null
        val userIds = secrets.get(USER_IDS_KEY) ?: run {
            phone.fill('\u0000')
            return null
        }
        return try {
            val array = JSONArray(userIds.concatToString())
            val ids = buildSet { for (index in 0 until array.length()) add(array.getLong(index)) }
            OwnerIdentity(phone.concatToString(), ids)
        } finally {
            phone.fill('\u0000')
            userIds.fill('\u0000')
        }
    }

    private companion object {
        const val PHONE_KEY = "owner_phone_e164"
        const val USER_IDS_KEY = "owner_telegram_user_ids"
    }
}
