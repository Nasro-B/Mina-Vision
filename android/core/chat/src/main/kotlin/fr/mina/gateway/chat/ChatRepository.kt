package fr.mina.gateway.chat

import fr.mina.gateway.protocol.ChatBinaryCodec
import fr.mina.gateway.protocol.ChatCrypto
import fr.mina.gateway.protocol.ChatEvent
import fr.mina.gateway.protocol.MediaChunker
import fr.mina.gateway.protocol.MonotonicUlid
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import java.security.PublicKey
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/** Message tel que l'INTERFACE le voit : le clair n'existe qu'ici, en mémoire. */
data class ChatMessage(
    val eventId: String,
    val threadId: String,
    val text: String,
    val fromAssistant: Boolean,
    val createdAtMs: Long,
    val deliveryState: String,
)

/** États d'un message sortant — repris tels quels de la spécification. */
object DeliveryState {
    const val LOCAL_PENDING = "local_pending"
    const val DIRECT_SENDING = "direct_sending"
    const val CLOUD_QUEUED = "cloud_queued"
    const val PC_RECEIVED = "pc_received"
    const val PROCESSING = "processing"
    const val RESPONSE_STREAMING = "response_streaming"
    const val COMPLETED = "completed"
    const val RETRY_WAIT = "retry_wait"
    const val FAILED_FINAL = "failed_final"
    /** Le PC est éteint : le message ATTEND, il n'est ni perdu ni répondu par un substitut. */
    const val WAITING_FOR_PC = "waiting_for_pc"
}

/**
 * Dépôt du chat : la seule porte entre l'interface et le stockage chiffré.
 *
 * Invariants tenus ici :
 *   - rien n'est écrit en clair (le chiffrement précède TOUJOURS l'écriture) ;
 *   - un message sortant est écrit avec sa ligne d'outbox dans la même transaction, donc il
 *     survit à une coupure et part au retour du PC ;
 *   - un événement reçu deux fois n'apparaît qu'une seule fois (déduplication par eventId).
 */
class ChatRepository(
    private val dao: ChatDao,
    private val deviceId: String,
    private val ulid: MonotonicUlid = MonotonicUlid(),
    private val now: () -> Long = System::currentTimeMillis,
    /** Fournit la clé de l'époque courante ; null quand le coffre est verrouillé. */
    private val epochKeyProvider: (Int) -> ByteArray?,
    private val currentEpoch: () -> Int = { 1 },
    private val signEvent: ((ChatEvent) -> String)? = null,
    private val verifyKey: PublicKey? = null,
) {
    companion object {
        private const val TTL_MS = 30L * 24 * 60 * 60 * 1_000
        private const val MAX_OUTBOX = 5_000
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val TAG_BITS = 128
    }

    /**
     * Compose, chiffre et met en file un message sortant. Retourne l'identifiant durable :
     * l'appelant peut suivre son état sans jamais manipuler le clair.
     */
    suspend fun sendText(threadId: String, text: String): String {
        require(text.isNotBlank()) { "chat_message_vide" }
        // Le texte v1 reste des octets UTF-8 bruts (jamais de payload v2) — contrat inchangé.
        return sealAndEnqueue(threadId, "message", text.toByteArray(Charsets.UTF_8))
    }

    /**
     * Envoie un média (image recompressée ou note vocale m4a) : un événement de métadonnées
     * (payload v2) puis N chunks binaires. Chaque événement est chiffré+signé comme un message.
     * Retourne le mediaId. Réutilise l'outbox durable : rien n'est perdu si le PC est éteint.
     */
    suspend fun sendMedia(threadId: String, bytes: ByteArray, mime: String, extraMeta: Map<String, Any> = emptyMap()): String {
        val piece = MediaChunker.chunk(bytes, mime, extraMeta)
        // Borne : refuse si l'outbox ne peut pas accueillir méta + tous les chunks.
        require(dao.outboxSize() + piece.chunkPayloads.size + 1 < MAX_OUTBOX) { "chat_outbox_pleine" }
        sealAndEnqueue(threadId, "message", piece.metaPayload)
        for (chunk in piece.chunkPayloads) sealAndEnqueue(threadId, "stream", chunk)
        return piece.mediaId
    }

    /** Chiffre+signe un payload (octets déjà encodés) et le met en file. Cœur commun texte/média. */
    private suspend fun sealAndEnqueue(threadId: String, routingClass: String, payload: ByteArray): String {
        require(dao.outboxSize() < MAX_OUTBOX) { "chat_outbox_pleine" }
        val epoch = currentEpoch()
        val epochKey = epochKeyProvider(epoch) ?: throw IllegalStateException("chat_coffre_verrouille")
        val createdAt = now()
        val eventId = ulid.next()
        val sequence = (dao.readThread(threadId).maxOfOrNull { it.deviceSequence } ?: 0L) + 1

        val header = ChatEvent(
            version = 2,
            eventId = eventId,
            threadId = threadId,
            senderDeviceId = deviceId,
            deviceSequence = sequence,
            keyEpoch = epoch,
            routingClass = routingClass,
            createdAtMs = createdAt,
            expiresAtMs = createdAt + TTL_MS,
            payloadCiphertext = "",
            nonce = "",
            authTag = "",
            signature = "",
        )

        val nonce = ByteArray(12).also { java.security.SecureRandom().nextBytes(it) }
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(epochKey, "AES"), GCMParameterSpec(TAG_BITS, nonce))
        cipher.updateAAD(ChatBinaryCodec.encodeHeader(header))
        val sealed = cipher.doFinal(payload)
        val encoder = Base64.getEncoder()

        val sealedEvent = header.copy(
            payloadCiphertext = encoder.encodeToString(sealed.copyOfRange(0, sealed.size - 16)),
            nonce = encoder.encodeToString(nonce),
            authTag = encoder.encodeToString(sealed.copyOfRange(sealed.size - 16, sealed.size)),
        )
        val signed = sealedEvent.copy(signature = signEvent?.invoke(sealedEvent) ?: "")

        dao.enqueueOutgoing(
            event = signed.toRow(deliveryState = DeliveryState.LOCAL_PENDING, fromAssistant = false),
            outbox = OutboxRow(
                eventId = eventId,
                threadId = threadId,
                queuedAtMs = createdAt,
                attemptCount = 0,
                nextAttemptAtMs = createdAt,
                lastError = null,
            ),
        )
        return eventId
    }

    /** Ingère un événement reçu — la déduplication par eventId rend l'appel idempotent. */
    suspend fun ingest(event: ChatEvent, fromAssistant: Boolean) {
        dao.insertEvent(event.toRow(deliveryState = DeliveryState.COMPLETED, fromAssistant = fromAssistant))
    }

    suspend fun markDelivered(eventId: String, state: String) {
        dao.updateDeliveryState(eventId, state)
        if (state == DeliveryState.COMPLETED || state == DeliveryState.PC_RECEIVED) dao.dequeue(eventId)
    }

    /**
     * Flux du fil, DÉCHIFFRÉ en mémoire. Coffre verrouillé, on n'invente rien : le message
     * apparaît avec un texte explicite plutôt qu'un contenu faux ou une liste vide.
     */
    fun observeThread(threadId: String): Flow<List<ChatMessage>> =
        dao.observeThread(threadId).map { rows -> rows.map { it.toMessage() } }

    fun observeThreads(): Flow<List<ThreadRow>> = dao.observeThreads()

    suspend fun pendingCount(): Int = dao.outboxSize()

    /** Un message précis, déchiffré en mémoire — utilisé pour l'aperçu d'une notification. */
    suspend fun readMessage(eventId: String): ChatMessage? = dao.findEvent(eventId)?.toMessage()

    private fun ChatEventRow.toMessage(): ChatMessage {
        val text = decryptOrExplain(this)
        return ChatMessage(
            eventId = eventId,
            threadId = threadId,
            text = text,
            fromAssistant = fromAssistant,
            createdAtMs = createdAtMs,
            deliveryState = deliveryState,
        )
    }

    private fun decryptOrExplain(row: ChatEventRow): String {
        val key = epochKeyProvider(row.keyEpoch) ?: return "🔒 Verrouillé — déverrouillez la mémoire pour lire"
        return try {
            val decoder = Base64.getDecoder()
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(TAG_BITS, decoder.decode(row.nonce)))
            cipher.updateAAD(ChatBinaryCodec.encodeHeader(row.toEvent()))
            String(
                cipher.doFinal(decoder.decode(row.payloadCiphertext) + decoder.decode(row.authTag)),
                Charsets.UTF_8,
            )
        } catch (error: Exception) {
            // Jamais de contenu inventé : on dit que le déchiffrement a échoué.
            "⚠️ Message illisible (clé d'époque ${row.keyEpoch} indisponible)"
        }
    }
}

internal fun ChatEvent.toRow(deliveryState: String, fromAssistant: Boolean) = ChatEventRow(
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
    deliveryState = deliveryState,
    fromAssistant = fromAssistant,
)

internal fun ChatEventRow.toEvent() = ChatEvent(
    version = 2,
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
