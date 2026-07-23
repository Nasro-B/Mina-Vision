package fr.mina.gateway.chat

import fr.mina.gateway.protocol.ChatBinaryCodec
import fr.mina.gateway.protocol.ChatEvent
import fr.mina.gateway.protocol.DeviceIdentityKeyStore
import java.security.PublicKey
import java.security.Signature
import java.util.Base64

/**
 * Signature des événements avec la clé d'identité de l'appareil (P-256, Keystore).
 *
 * On signe l'encodage BINAIRE canonique, pas un JSON : deux JSON équivalents peuvent différer
 * d'un octet (ordre des clés, espaces) et invalider une signature pourtant légitime. La base
 * signée est donc la même des deux côtés, bit pour bit.
 */
class ChatSigner(private val keyStore: DeviceIdentityKeyStore = DeviceIdentityKeyStore()) {
    private val pair by lazy { keyStore.getOrCreateSigningKey() }

    val publicKey: PublicKey get() = pair.public

    /**
     * Clé privée de l'appareil. Exposée UNIQUEMENT pour l'accord ECDH d'appairage : elle ne
     * quitte jamais le processus et n'est jamais sérialisée.
     */
    val privateKey: java.security.PrivateKey get() = pair.private

    val publicKeySpkiBase64: String get() = Base64.getEncoder().encodeToString(pair.public.encoded)

    fun sign(event: ChatEvent): String {
        val signer = Signature.getInstance("SHA256withECDSA")
        signer.initSign(pair.private)
        signer.update(ChatBinaryCodec.encodeSignatureInput(event.copy(signature = "")))
        return Base64.getEncoder().encodeToString(signer.sign())
    }

    fun verify(event: ChatEvent, key: PublicKey): Boolean = runCatching {
        val verifier = Signature.getInstance("SHA256withECDSA")
        verifier.initVerify(key)
        verifier.update(ChatBinaryCodec.encodeSignatureInput(event.copy(signature = "")))
        verifier.verify(Base64.getDecoder().decode(event.signature))
    }.getOrDefault(false)
}
