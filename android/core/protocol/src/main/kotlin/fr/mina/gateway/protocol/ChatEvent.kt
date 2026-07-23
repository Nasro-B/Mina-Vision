package fr.mina.gateway.protocol

import org.json.JSONObject
import java.util.Base64

/**
 * Événement du canal `mina_app` (chat natif), version 2 de l'enveloppe.
 *
 * Miroir EXACT de `src/contracts/chat.mjs` côté PC : mêmes champs, mêmes bornes, même fixture
 * de test. Toute divergence casserait la vérification de signature d'un côté ou de l'autre.
 *
 * Un événement est APPEND-ONLY : une correction ou une suppression est un nouvel événement
 * signé, jamais une réécriture.
 */
data class ChatEvent(
    val version: Int,
    val eventId: String,
    val threadId: String,
    val senderDeviceId: String,
    val deviceSequence: Long,
    val keyEpoch: Int,
    val routingClass: String,
    val createdAtMs: Long,
    val expiresAtMs: Long,
    val payloadCiphertext: String,
    val nonce: String,
    val authTag: String,
    val signature: String,
)

object ChatEventCodec {
    const val ENVELOPE_VERSION = 2

    /** Classes de routage en CLAIR : volontairement grossières, elles ne révèlent rien. */
    val routingClasses = setOf("message", "receipt", "control", "stream", "approval")

    /** Types réels — CHIFFRÉS dans le payload, jamais sur le réseau en clair. */
    val eventTypes = setOf(
        "message.text.created", "message.attachment.created", "message.voice.created",
        "message.status.changed", "assistant.response.started", "assistant.response.chunk",
        "assistant.response.completed", "assistant.response.failed", "approval.requested",
        "approval.approved", "approval.denied", "device.role.changed", "device.endpoint.changed",
        "device.revoked", "history.snapshot.available", "thread.created", "thread.renamed",
        "thread.archived", "thread.tombstoned", "thread.purged",
    )

    private val fields = setOf(
        "version", "eventId", "threadId", "senderDeviceId", "deviceSequence", "keyEpoch",
        "routingClass", "createdAtMs", "expiresAtMs", "payloadCiphertext", "nonce", "authTag",
        "signature",
    )

    // Bornes interopérables : au-delà, le PC (JavaScript) ne pourrait plus représenter la valeur.
    private const val MAX_SAFE_SEQUENCE = 9_007_199_254_740_991L
    private const val MAX_KEY_EPOCH = Int.MAX_VALUE
    private const val MAX_CIPHERTEXT_BASE64 = 196_608
    private const val MAX_TTL_MS = 30L * 24 * 60 * 60 * 1_000
    private const val MAX_IDENTIFIER = 160

    private val ulidPattern = Regex("^[0-9A-HJKMNP-TV-Z]{26}$")
    private val identifierPattern = Regex("^[A-Za-z0-9._:-]{1,$MAX_IDENTIFIER}$")

    /**
     * Base64 CANONIQUE : décoder puis réencoder doit rendre exactement la chaîne reçue.
     * Sans cela, deux encodages du même contenu donneraient deux digests différents et
     * l'anti-replay par digest deviendrait contournable.
     */
    private fun decodeCanonical(value: String): ByteArray? = try {
        val bytes = Base64.getDecoder().decode(value)
        if (Base64.getEncoder().encodeToString(bytes) == value) bytes else null
    } catch (error: IllegalArgumentException) {
        null
    }

    fun decode(json: JSONObject): ChatEvent {
        val keys = json.keys().asSequence().toSet()
        require(keys == fields) { "chat_event_champs_invalides" }
        require(json.getInt("version") == ENVELOPE_VERSION) { "chat_event_version_invalide" }

        val eventId = json.getString("eventId")
        require(ulidPattern.matches(eventId)) { "chat_event_id_ulid_invalide" }

        val threadId = json.getString("threadId")
        val senderDeviceId = json.getString("senderDeviceId")
        require(identifierPattern.matches(threadId)) { "chat_event_thread_id_invalide" }
        require(identifierPattern.matches(senderDeviceId)) { "chat_event_sender_id_invalide" }

        val deviceSequence = json.getLong("deviceSequence")
        require(deviceSequence in 1..MAX_SAFE_SEQUENCE) { "chat_event_sequence_invalide" }

        val keyEpoch = json.getInt("keyEpoch")
        require(keyEpoch in 1..MAX_KEY_EPOCH) { "chat_event_key_epoch_invalide" }

        val routingClass = json.getString("routingClass")
        require(routingClasses.contains(routingClass)) { "chat_event_routing_class_invalide" }

        val createdAtMs = json.getLong("createdAtMs")
        val expiresAtMs = json.getLong("expiresAtMs")
        require(createdAtMs in 1..MAX_SAFE_SEQUENCE) { "chat_event_created_at_invalide" }
        require(expiresAtMs in 1..MAX_SAFE_SEQUENCE) { "chat_event_expires_at_invalide" }
        require(expiresAtMs > createdAtMs) { "chat_event_expiration_anterieure" }
        require(expiresAtMs - createdAtMs <= MAX_TTL_MS) { "chat_event_ttl_superieur_a_30_jours" }

        val payloadCiphertext = json.getString("payloadCiphertext")
        require(payloadCiphertext.length in 1..MAX_CIPHERTEXT_BASE64) { "chat_event_ciphertext_taille" }
        require(decodeCanonical(payloadCiphertext) != null) { "chat_event_ciphertext_base64_non_canonique" }

        val nonce = json.getString("nonce")
        require(decodeCanonical(nonce)?.size == 12) { "chat_event_nonce_invalide" }

        val authTag = json.getString("authTag")
        require(decodeCanonical(authTag)?.size == 16) { "chat_event_auth_tag_invalide" }

        val signature = json.getString("signature")
        require(signature.length <= 96) { "chat_event_signature_taille" }
        val signatureBytes = decodeCanonical(signature)
        require(signatureBytes != null && signatureBytes.size in 8..72) { "chat_event_signature_invalide" }
        // DER : séquence 0x30 dont la longueur déclarée correspond au reste exact.
        require(signatureBytes[0] == 0x30.toByte() && signatureBytes[1].toInt() == signatureBytes.size - 2) {
            "chat_event_signature_der_invalide"
        }

        return ChatEvent(
            version = ENVELOPE_VERSION,
            eventId = eventId,
            threadId = threadId,
            senderDeviceId = senderDeviceId,
            deviceSequence = deviceSequence,
            keyEpoch = keyEpoch,
            routingClass = routingClass,
            createdAtMs = createdAtMs,
            expiresAtMs = expiresAtMs,
            payloadCiphertext = payloadCiphertext,
            nonce = nonce,
            authTag = authTag,
            signature = signature,
        )
    }

    fun decode(json: String): ChatEvent = decode(JSONObject(json))

    /**
     * Sérialise l'événement en n'écrivant QUE les 13 champs du contrat, puis se relit avec
     * [decode] : un événement mal formé échoue ici, chez l'expéditeur, plutôt que d'être rejeté
     * silencieusement à l'autre bout.
     */
    fun encode(event: ChatEvent): JSONObject {
        val json = JSONObject()
            .put("version", ENVELOPE_VERSION)
            .put("eventId", event.eventId)
            .put("threadId", event.threadId)
            .put("senderDeviceId", event.senderDeviceId)
            .put("deviceSequence", event.deviceSequence)
            .put("keyEpoch", event.keyEpoch)
            .put("routingClass", event.routingClass)
            .put("createdAtMs", event.createdAtMs)
            .put("expiresAtMs", event.expiresAtMs)
            .put("payloadCiphertext", event.payloadCiphertext)
            .put("nonce", event.nonce)
            .put("authTag", event.authTag)
            .put("signature", event.signature)
        decode(json)
        return json
    }
}
