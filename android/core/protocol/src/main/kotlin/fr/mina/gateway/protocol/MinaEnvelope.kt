package fr.mina.gateway.protocol

data class EnvelopeSender(
    val identityId: String,
    val deviceId: String,
)

data class EnvelopeAlgorithms(
    val encryption: String,
    val signature: String,
)

data class MinaEnvelope(
    val version: Int,
    val id: String,
    val correlationId: String,
    val channel: String,
    val kind: String,
    val createdAt: String,
    val expiresAt: String?,
    val sender: EnvelopeSender,
    val counter: Long,
    val algorithms: EnvelopeAlgorithms,
    val payloadCiphertext: String,
    val nonce: String,
    val authTag: String,
    val signature: String,
)

data class VerifiedEnvelope(
    val counter: Long,
    val plaintext: ByteArray,
)
