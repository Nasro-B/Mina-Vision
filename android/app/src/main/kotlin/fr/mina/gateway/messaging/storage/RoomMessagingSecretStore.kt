package fr.mina.gateway.messaging.storage

import fr.mina.gateway.messaging.MessagingSecretStore

class RoomMessagingSecretStore(
    private val dao: MessagingSecretDao,
    private val cipher: MessagingFieldCipher,
) : MessagingSecretStore {
    override fun put(name: String, secret: CharArray) {
        validateName(name)
        require(secret.isNotEmpty() && secret.size <= 4096) { "messaging_secret_invalid" }
        try {
            dao.upsert(
                EncryptedSecretEntity(
                    cipher.blindIndex(name),
                    cipher.encrypt("name:$name", name.toCharArray()),
                    cipher.encrypt("value:$name", secret),
                    System.currentTimeMillis(),
                ),
            )
        } finally {
            secret.fill('\u0000')
        }
    }

    override fun get(name: String): CharArray? {
        validateName(name)
        val row = dao.find(cipher.blindIndex(name)) ?: return null
        return cipher.decrypt("value:$name", row.valueCiphertext)
    }

    override fun has(name: String): Boolean {
        validateName(name)
        return dao.count(cipher.blindIndex(name)) == 1
    }

    override fun remove(name: String) {
        validateName(name)
        dao.delete(cipher.blindIndex(name))
    }

    private fun validateName(name: String) {
        require(name.matches(Regex("^[a-z][a-z0-9_]{2,63}$"))) { "messaging_secret_name_invalid" }
    }
}
