package fr.mina.gateway.chat

import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ListenerRegistration
import fr.mina.gateway.protocol.ChatEvent
import fr.mina.gateway.protocol.ChatEventCodec
import org.json.JSONObject

/**
 * Chemin de secours par Firebase, quand le téléphone n'est pas sur le réseau du PC.
 *
 * Ce qui transite ici est EXACTEMENT ce qui transite en direct : la même enveloppe chiffrée et
 * signée. Firebase ne voit jamais de clair et ne peut rien injecter — le PC vérifie la signature
 * avant de déchiffrer, et l'application fait de même pour les réponses.
 *
 * Le relais n'est utilisé que si le lien direct n'est pas disponible : le direct reste le chemin
 * normal, plus rapide et sans tiers.
 */
class FirebaseChatRelay(
    private val deviceId: String,
    private val onEvent: (ChatEvent) -> Unit,
    private val firestore: FirebaseFirestore = FirebaseFirestore.getInstance(),
    private val auth: FirebaseAuth = FirebaseAuth.getInstance(),
) {
    private var registration: ListenerRegistration? = null

    @Volatile
    var lastError: String? = null
        private set

    companion object {
        private const val COLLECTION = "relay"
        private const val TARGET_PC = "pc"
        private const val TARGET_DEVICE = "device"
    }

    /** Vrai seulement si une session anonyme existe réellement — jamais par optimisme. */
    fun isReady(): Boolean = auth.currentUser != null

    fun ensureSession(onReady: (Boolean) -> Unit) {
        if (auth.currentUser != null) {
            onReady(true)
            return
        }
        auth.signInAnonymously()
            .addOnSuccessListener { onReady(true) }
            .addOnFailureListener { error ->
                lastError = "Relais indisponible : ${error.message}"
                onReady(false)
            }
    }

    /** Dépose l'événement chiffré. `onResult(false)` = rien n'est parti, le message reste en file. */
    fun send(event: ChatEvent, onResult: (Boolean) -> Unit) {
        if (!isReady()) {
            lastError = "Relais non authentifié"
            onResult(false)
            return
        }
        val document = toMap(event, TARGET_PC)
        firestore.collection(COLLECTION).document(event.eventId).set(document)
            .addOnSuccessListener { onResult(true) }
            .addOnFailureListener { error ->
                lastError = error.message
                onResult(false)
            }
    }

    /** Écoute les réponses qui NOUS sont destinées, et supprime chaque document consommé. */
    fun watch() {
        if (registration != null) return
        registration = firestore.collection(COLLECTION)
            .whereEqualTo("target", TARGET_DEVICE)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    lastError = error.message
                    return@addSnapshotListener
                }
                snapshot?.documentChanges.orEmpty()
                    .filter { it.type == com.google.firebase.firestore.DocumentChange.Type.ADDED }
                    .forEach { change ->
                        runCatching {
                            val event = ChatEventCodec.decode(toJson(change.document.data))
                            onEvent(event)
                            // Consommé : on retire le document. Le relais ne conserve rien.
                            change.document.reference.delete()
                        }.onFailure { failure ->
                            lastError = "Réponse relayée illisible : ${failure.message}"
                        }
                    }
            }
    }

    fun stop() {
        registration?.remove()
        registration = null
    }

    private fun toMap(event: ChatEvent, target: String): Map<String, Any> = mapOf(
        "version" to 2L,
        "eventId" to event.eventId,
        "threadId" to event.threadId,
        "senderDeviceId" to event.senderDeviceId,
        "deviceSequence" to event.deviceSequence,
        "keyEpoch" to event.keyEpoch.toLong(),
        "routingClass" to event.routingClass,
        "createdAtMs" to event.createdAtMs,
        "expiresAtMs" to event.expiresAtMs,
        "payloadCiphertext" to event.payloadCiphertext,
        "nonce" to event.nonce,
        "authTag" to event.authTag,
        "signature" to event.signature,
        "target" to target,
        "relayedAtMs" to System.currentTimeMillis(),
    )

    /** Firestore rend des Long/Double : on reconstruit un JSON conforme au contrat. */
    private fun toJson(data: Map<String, Any?>): JSONObject = JSONObject()
        .put("version", 2)
        .put("eventId", data["eventId"] as String)
        .put("threadId", data["threadId"] as String)
        .put("senderDeviceId", data["senderDeviceId"] as String)
        .put("deviceSequence", (data["deviceSequence"] as Number).toLong())
        .put("keyEpoch", (data["keyEpoch"] as Number).toInt())
        .put("routingClass", data["routingClass"] as String)
        .put("createdAtMs", (data["createdAtMs"] as Number).toLong())
        .put("expiresAtMs", (data["expiresAtMs"] as Number).toLong())
        .put("payloadCiphertext", data["payloadCiphertext"] as String)
        .put("nonce", data["nonce"] as String)
        .put("authTag", data["authTag"] as String)
        .put("signature", data["signature"] as String)
}
