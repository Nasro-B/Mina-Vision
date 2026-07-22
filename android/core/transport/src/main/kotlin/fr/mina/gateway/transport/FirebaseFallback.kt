package fr.mina.gateway.transport

data class FirebaseEnvelope(
    val id: String,
    val kind: String,
    val createdAtEpochMs: Long,
    val expiresAtEpochMs: Long,
    val payloadCiphertext: String,
    val nonce: String,
    val authTag: String,
    val signature: String,
)

interface FirebaseEnvelopeStore {
    fun put(value: FirebaseEnvelope)
    fun get(id: String): FirebaseEnvelope?
    fun remove(id: String)
}

data class FirebaseDelivery(
    val envelope: FirebaseEnvelope? = null,
    val capabilities: Set<String> = emptySet(),
    val duplicate: Boolean = false,
)

class FirebaseFallback(
    private val store: FirebaseEnvelopeStore,
    private val clock: () -> Long,
) {
    private val consumed = mutableSetOf<String>()

    fun enqueue(envelope: FirebaseEnvelope, directTransportAvailable: Boolean) {
        require(!directTransportAvailable) { "firebase_direct_transport_available" }
        require(envelope.id.matches(Regex("^[A-Za-z0-9._:-]{1,200}$"))) { "firebase_envelope_id_invalid" }
        require(!envelope.kind.startsWith("camera.") && !envelope.kind.startsWith("face.")
            && envelope.kind != "email.body" && !envelope.kind.startsWith("secret.")) { "firebase_payload_forbidden" }
        require(envelope.payloadCiphertext.isNotEmpty() && envelope.nonce.isNotEmpty()
            && envelope.authTag.isNotEmpty() && envelope.signature.isNotEmpty()) { "firebase_ciphertext_invalid" }
        require(envelope.expiresAtEpochMs > clock()) { "firebase_envelope_expired" }
        require(envelope.expiresAtEpochMs - envelope.createdAtEpochMs <= 24 * 60 * 60 * 1000L) { "firebase_ttl_exceeded" }
        store.put(envelope)
    }

    fun receive(id: String): FirebaseDelivery {
        if (id in consumed) return FirebaseDelivery(duplicate = true)
        val envelope = store.get(id) ?: error("firebase_envelope_unknown")
        if (envelope.expiresAtEpochMs <= clock()) {
            store.remove(id)
            error("firebase_envelope_expired")
        }
        consumed += id
        store.remove(id)
        return FirebaseDelivery(envelope = envelope)
    }
}
