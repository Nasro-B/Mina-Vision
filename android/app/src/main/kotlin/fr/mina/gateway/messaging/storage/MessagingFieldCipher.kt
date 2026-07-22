package fr.mina.gateway.messaging.storage

interface MessagingFieldCipher {
    fun blindIndex(label: String): String
    fun encrypt(label: String, plaintext: CharArray): String
    fun decrypt(label: String, ciphertext: String): CharArray
}
