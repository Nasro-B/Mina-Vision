package fr.mina.gateway.protocol

import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.security.KeyFactory
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.time.Instant
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

object EnvelopeCodec {
    private val rootFields = setOf(
        "version", "id", "correlationId", "channel", "kind", "createdAt", "expiresAt",
        "sender", "counter", "algorithms", "payloadCiphertext", "nonce", "authTag", "signature",
    )
    // `mina_app` = chat natif de cette application, autorisé par MINA.md § Canaux.
    private val channels = setOf("local", "voice", "sms", "telegram", "mina_app")

    fun decodeJson(json: String): MinaEnvelope {
        val value = JSONObject(json)
        require(value.keys().asSequence().toSet() == rootFields) { "envelope_fields_invalid" }
        val sender = value.getJSONObject("sender")
        require(sender.keys().asSequence().toSet() == setOf("identityId", "deviceId")) { "envelope_sender_invalid" }
        val algorithms = value.getJSONObject("algorithms")
        require(algorithms.keys().asSequence().toSet() == setOf("encryption", "signature")) { "envelope_algorithms_invalid" }
        return MinaEnvelope(
            version = value.getInt("version"),
            id = value.getString("id"),
            correlationId = value.getString("correlationId"),
            channel = value.getString("channel"),
            kind = value.getString("kind"),
            createdAt = value.getString("createdAt"),
            expiresAt = if (value.isNull("expiresAt")) null else value.getString("expiresAt"),
            sender = EnvelopeSender(sender.getString("identityId"), sender.getString("deviceId")),
            counter = value.getLong("counter"),
            algorithms = EnvelopeAlgorithms(algorithms.getString("encryption"), algorithms.getString("signature")),
            payloadCiphertext = value.getString("payloadCiphertext"),
            nonce = value.getString("nonce"),
            authTag = value.getString("authTag"),
            signature = value.getString("signature"),
        )
    }

    private fun fields(value: MinaEnvelope): List<Any> = listOf(
        value.version,
        value.id,
        value.correlationId,
        value.channel,
        value.kind,
        value.createdAt,
        value.expiresAt ?: "",
        value.sender.identityId,
        value.sender.deviceId,
        value.counter,
        value.algorithms.encryption,
        value.algorithms.signature,
    )

    private fun framed(values: List<Any>): ByteArray = values.joinToString("|") { raw ->
        val text = raw.toString()
        "${text.toByteArray(StandardCharsets.UTF_8).size}:$text"
    }.toByteArray(StandardCharsets.UTF_8)

    fun canonicalHeader(value: MinaEnvelope): ByteArray = framed(fields(value))

    fun canonicalSigningBytes(value: MinaEnvelope): ByteArray = framed(
        fields(value) + listOf(value.payloadCiphertext, value.nonce, value.authTag),
    )

    fun verifyAndDecrypt(
        envelope: MinaEnvelope,
        aesKey: ByteArray,
        publicKeySpkiBase64: String,
        nowEpochMs: Long,
        lastCounter: Long,
    ): VerifiedEnvelope {
        require(envelope.version == 1) { "envelope_version_unsupported" }
        require(envelope.channel in channels) { "envelope_channel_invalid" }
        require(envelope.algorithms == EnvelopeAlgorithms("A256GCM", "ES256")) { "envelope_algorithms_invalid" }
        require(envelope.counter > 0 && lastCounter >= 0) { "envelope_counter_invalid" }
        val expiresAt = envelope.expiresAt?.let(Instant::parse)?.toEpochMilli()
        require(expiresAt == null || expiresAt > nowEpochMs) { "envelope_expired" }
        require(envelope.counter > lastCounter) { "envelope_replay_rejected" }

        val publicKey = KeyFactory.getInstance("EC").generatePublic(
            X509EncodedKeySpec(Base64.getDecoder().decode(publicKeySpkiBase64)),
        )
        val verifier = Signature.getInstance("SHA256withECDSA")
        verifier.initVerify(publicKey)
        verifier.update(canonicalSigningBytes(envelope))
        val signatureValid = try {
            verifier.verify(Base64.getDecoder().decode(envelope.signature))
        } catch (_: Exception) {
            false
        }
        require(signatureValid) { "envelope_signature_invalid" }

        require(aesKey.size == 32) { "envelope_aes_key_invalid" }
        val nonce = Base64.getDecoder().decode(envelope.nonce)
        val tag = Base64.getDecoder().decode(envelope.authTag)
        require(nonce.size == 12 && tag.size == 16) { "envelope_aead_fields_invalid" }
        val combined = Base64.getDecoder().decode(envelope.payloadCiphertext) + tag
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(aesKey, "AES"), GCMParameterSpec(128, nonce))
        cipher.updateAAD(canonicalHeader(envelope))
        return VerifiedEnvelope(envelope.counter, cipher.doFinal(combined))
    }
}
