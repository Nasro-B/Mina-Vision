package fr.mina.gateway.protocol

import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets
import java.util.Base64

/**
 * Encodage binaire CANONIQUE — miroir exact de `src/contracts/chat-binary-codec.mjs`.
 *
 * Pourquoi pas du JSON : l'ordre des clés n'est pas garanti entre plateformes et un simple
 * espace changerait les octets signés. Une signature ne vaut que si les DEUX camps calculent
 * exactement les mêmes octets — d'où ce format à longueurs préfixées, domain-separated,
 * vérifié par des vecteurs communs (tests/fixtures/protocol/mina-chat-codec-vectors.json).
 */
object ChatBinaryCodec {
    const val AAD_PREFIX = "MINA_CHAT_EVENT_V2\u0000"
    const val SIGNATURE_PREFIX = "MINA_CHAT_SIGNATURE_V1\u0000"
    private const val MAX_FIELD_BYTES = 4096

    private fun uint16(value: Int): ByteArray =
        ByteBuffer.allocate(2).putShort(value.toShort()).array()

    private fun uint32(value: Int): ByteArray =
        ByteBuffer.allocate(4).putInt(value).array()

    private fun uint64(value: Long): ByteArray =
        ByteBuffer.allocate(8).putLong(value).array()

    /**
     * Chaîne précédée de sa longueur UTF-8 : impossible de confondre deux champs voisins en
     * déplaçant une frontière (« ab|c » et « a|bc » produiraient des octets différents).
     */
    private fun lengthPrefixedUtf8(value: String): ByteArray {
        val bytes = value.toByteArray(StandardCharsets.UTF_8)
        require(bytes.size <= MAX_FIELD_BYTES) { "chat_codec_champ_trop_long" }
        return uint32(bytes.size) + bytes
    }

    private fun lengthPrefixedBytes(bytes: ByteArray): ByteArray = uint32(bytes.size) + bytes

    /**
     * AAD : données AUTHENTIFIÉES mais non chiffrées. Elles lient le ciphertext à son contexte
     * exact — changer l'expéditeur, le fil ou l'époque invalide le déchiffrement.
     */
    fun encodeHeader(event: ChatEvent): ByteArray {
        val out = ByteArrayOutputStream()
        out.write(AAD_PREFIX.toByteArray(StandardCharsets.US_ASCII))
        out.write(uint16(event.version))
        out.write(lengthPrefixedUtf8(event.eventId))
        out.write(lengthPrefixedUtf8(event.threadId))
        out.write(lengthPrefixedUtf8(event.senderDeviceId))
        out.write(uint64(event.deviceSequence))
        out.write(uint32(event.keyEpoch))
        out.write(lengthPrefixedUtf8(event.routingClass))
        out.write(uint64(event.createdAtMs))
        out.write(uint64(event.expiresAtMs))
        return out.toByteArray()
    }

    /**
     * Entrée de signature : l'AAD complet PLUS le ciphertext, le nonce et le tag. Signer aussi
     * le contenu empêche de recoller un ciphertext valide sur l'en-tête d'un autre événement.
     */
    fun encodeSignatureInput(event: ChatEvent): ByteArray {
        val header = encodeHeader(event)
        val decoder = Base64.getDecoder()
        val out = ByteArrayOutputStream()
        out.write(SIGNATURE_PREFIX.toByteArray(StandardCharsets.US_ASCII))
        out.write(lengthPrefixedBytes(header))
        out.write(lengthPrefixedBytes(decoder.decode(event.nonce)))
        out.write(lengthPrefixedBytes(decoder.decode(event.payloadCiphertext)))
        out.write(lengthPrefixedBytes(decoder.decode(event.authTag)))
        return out.toByteArray()
    }

    fun toHex(bytes: ByteArray): String = bytes.joinToString("") { "%02x".format(it) }
}
