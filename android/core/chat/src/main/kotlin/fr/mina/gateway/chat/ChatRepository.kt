package fr.mina.gateway.chat

import fr.mina.gateway.protocol.ChatBinaryCodec
import fr.mina.gateway.protocol.ChatCrypto
import fr.mina.gateway.protocol.ChatEvent
import fr.mina.gateway.protocol.ChatPayloadCodec
import fr.mina.gateway.protocol.MediaAssembler
import fr.mina.gateway.protocol.MediaChunker
import fr.mina.gateway.protocol.MonotonicUlid
import fr.mina.gateway.protocol.VoicePcmFormat
import org.json.JSONObject
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
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
    /** text | image | voice | chunk (les chunks sont masqués du fil) */
    val kind: String = "text",
    val mediaId: String? = null,
    val mime: String? = null,
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
    /** Le PC appairé sait-il TRAITER les pièces jointes (payload v2) ? Négocié au handshake. */
    private val peerAcceptsMedia: () -> Boolean = { true },
    /** Capture PCM chiffrée hors Room ; absente dans les tests/consommateurs non audio. */
    private val attachmentStore: EncryptedAttachmentStore? = null,
) {
    companion object {
        private const val TTL_MS = 30L * 24 * 60 * 60 * 1_000
        private const val MAX_OUTBOX = 5_000
        private const val MAX_TEXT_UTF8_BYTES = 32 * 1_024
        private const val VISIBLE_THREAD_WINDOW = 200
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val TAG_BITS = 128
    }

    /** Sérialise la réservation et la reprise des ULID d'une même note vocale. */
    private val voiceEnqueueMutex = Mutex()

    /**
     * Compose, chiffre et met en file un message sortant. Retourne l'identifiant durable :
     * l'appelant peut suivre son état sans jamais manipuler le clair.
     */
    suspend fun sendText(threadId: String, text: String): String {
        val normalized = text.trim()
        require(normalized.isNotEmpty()) { "chat_message_vide" }
        val plaintext = normalized.toByteArray(Charsets.UTF_8)
        require(plaintext.size <= MAX_TEXT_UTF8_BYTES) { "chat_message_trop_long" }
        // Le texte v1 reste des octets UTF-8 bruts (jamais de payload v2) — contrat inchangé.
        return sealAndEnqueue(threadId, "message", plaintext)
    }

    /**
     * Envoie un média (image recompressée ou note vocale m4a) : un événement de métadonnées
     * (payload v2) puis N chunks binaires. Chaque événement est chiffré+signé comme un message.
     * Retourne le mediaId. Réutilise l'outbox durable : rien n'est perdu si le PC est éteint.
     */
    suspend fun sendMedia(threadId: String, bytes: ByteArray, mime: String, extraMeta: Map<String, Any> = emptyMap()): String {
        // Négociation : si le PC appairé n'a pas annoncé savoir traiter les pièces jointes, on
        // refuse AVANT d'envoyer — mieux vaut le dire que voir le média acquitté puis perdu.
        if (!peerAcceptsMedia()) throw IllegalStateException("chat_pc_sans_pieces_jointes")
        val piece = MediaChunker.chunk(bytes, mime, extraMeta)
        // Borne : refuse si l'outbox ne peut pas accueillir méta + tous les chunks.
        require(dao.outboxSize() + piece.chunkPayloads.size + 1 < MAX_OUTBOX) { "chat_outbox_pleine" }
        sealAndEnqueue(threadId, "message", piece.metaPayload)
        for (chunk in piece.chunkPayloads) sealAndEnqueue(threadId, "stream", chunk)
        return piece.mediaId
    }

    /** Ouvre une capture PCM dont les paquets sont chiffrés avant toute écriture locale. */
    fun beginVoiceCapture(threadId: String): EncryptedVoiceAttachmentSink =
        attachmentStore?.createVoiceCapture(threadId)
            ?: throw IllegalStateException("chat_capture_indisponible")

    /**
     * Transforme une capture déjà chiffrée en méta puis chunks E2EE. Les ULID sont écrits dans le
     * manifeste AVANT le premier événement ; une reprise après erreur ne peut donc pas en créer de
     * nouveaux pour les mêmes morceaux.
     */
    suspend fun enqueueVoice(capture: StoredVoiceAttachment): String = voiceEnqueueMutex.withLock {
        if (!peerAcceptsMedia()) throw IllegalStateException("chat_pc_sans_pieces_jointes")
        require(capture.mime == VoicePcmFormat.MIME) { "voice_mime_invalide" }

        val plannedCapture = if (capture.deliveryEventIds.isEmpty()) {
            capture.withDeliveryPlan(List(capture.chunkCount + 1) { ulid.next() })
        } else {
            require(capture.deliveryEventIds.size == capture.chunkCount + 1) { "voice_plan_livraison_invalide" }
            capture
        }
        val missingEventIds = LinkedHashSet<String>()
        for (eventId in plannedCapture.deliveryEventIds) {
            if (dao.findEvent(eventId) == null) missingEventIds += eventId
        }
        require(dao.outboxSize() + missingEventIds.size < MAX_OUTBOX) { "chat_outbox_pleine" }

        val meta = MediaChunker.encodeMeta(
            mediaId = plannedCapture.mediaId,
            mime = plannedCapture.mime,
            sizeBytes = plannedCapture.sizeBytes,
            sha256 = plannedCapture.sha256,
            chunkCount = plannedCapture.chunkCount,
            chunkBytes = plannedCapture.chunkBytes,
            extraMeta = mapOf("durationMs" to plannedCapture.durationMs),
        )
        try {
            val metaEventId = plannedCapture.deliveryEventIds.first()
            if (metaEventId in missingEventIds) {
                sealAndEnqueue(plannedCapture.threadId, "message", meta, eventId = metaEventId)
            }
        } finally {
            meta.fill(0)
        }

        for (index in 0 until plannedCapture.chunkCount) {
            val eventId = plannedCapture.deliveryEventIds[index + 1]
            if (eventId !in missingEventIds) continue
            val chunk = plannedCapture.readChunk(index)
            var payload: ByteArray? = null
            try {
                payload = MediaChunker.encodeChunk(plannedCapture.mediaId, index, chunk)
                sealAndEnqueue(plannedCapture.threadId, "stream", payload, eventId = eventId)
            } finally {
                chunk.fill(0)
                payload?.fill(0)
            }
        }
        plannedCapture.deletePersistedCapture()
        plannedCapture.mediaId
    }

    /** Chiffre+signe un payload (octets déjà encodés) et le met en file. Cœur commun texte/média. */
    private suspend fun sealAndEnqueue(
        threadId: String,
        routingClass: String,
        payload: ByteArray,
        eventId: String = ulid.next(),
    ): String {
        require(dao.outboxSize() < MAX_OUTBOX) { "chat_outbox_pleine" }
        val epoch = currentEpoch()
        val epochKey = epochKeyProvider(epoch)?.copyOf() ?: throw IllegalStateException("chat_coffre_verrouille")
        val createdAt = now()
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
        var sealed: ByteArray? = null
        try {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(epochKey, "AES"), GCMParameterSpec(TAG_BITS, nonce))
            cipher.updateAAD(ChatBinaryCodec.encodeHeader(header))
            val ciphertext = cipher.doFinal(payload)
            sealed = ciphertext
            val encoder = Base64.getEncoder()

            val sealedEvent = header.copy(
                payloadCiphertext = encoder.encodeToString(ciphertext.copyOfRange(0, ciphertext.size - 16)),
                nonce = encoder.encodeToString(nonce),
                authTag = encoder.encodeToString(ciphertext.copyOfRange(ciphertext.size - 16, ciphertext.size)),
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
        } finally {
            epochKey.fill(0)
            nonce.fill(0)
            sealed?.fill(0)
        }
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
     * Fenêtre DÉCHIFFRÉE en mémoire des 200 messages visibles les plus récents. Coffre verrouillé,
     * on n'invente rien : le message apparaît avec un texte explicite plutôt qu'un contenu faux.
     * Les chunks binaires sont exclus par Room avant le déchiffrement : ils portent des octets,
     * pas un message ; la bulle média vient de l'événement de métadonnées.
     */
    fun observeThread(threadId: String): Flow<List<ChatMessage>> =
        dao.observeThread(threadId, VISIBLE_THREAD_WINDOW).map { rows -> rows.map { it.toMessage() } }

    fun observeThreads(): Flow<List<ThreadRow>> = dao.observeThreads()

    suspend fun pendingCount(): Int = dao.outboxSize()

    /** Un message précis, déchiffré en mémoire — utilisé pour l'aperçu d'une notification. */
    suspend fun readMessage(eventId: String): ChatMessage? = dao.findEvent(eventId)?.toMessage()

    private fun ChatEventRow.toMessage(): ChatMessage {
        val bytes = decryptBytesOrNull(this)
            ?: return ChatMessage(
                eventId = eventId, threadId = threadId,
                text = if (epochKeyProvider(keyEpoch) == null) "🔒 Verrouillé — déverrouillez la mémoire pour lire"
                else "⚠️ Message illisible (clé d'époque $keyEpoch indisponible)",
                fromAssistant = fromAssistant, createdAtMs = createdAtMs, deliveryState = deliveryState,
            )
        // Décodage du payload : texte v1 brut, ou payload v2 (média). Un octet discriminateur
        // inattendu ne casse jamais le fil — il devient un texte UTF-8 comme avant.
        val decoded = runCatching { ChatPayloadCodec.decode(bytes) }.getOrNull()
        return when (decoded) {
            is ChatPayloadCodec.PayloadV2 -> {
                val meta = runCatching { JSONObject(decoded.metaJson) }.getOrNull()
                val mediaId = meta?.optString("mediaId")?.takeIf { it.isNotBlank() }
                when (decoded.type) {
                    "message.attachment.created" -> ChatMessage(
                        eventId, threadId, "📷 Image", fromAssistant, createdAtMs, deliveryState,
                        kind = "image", mediaId = mediaId, mime = meta?.optString("mime"),
                    )
                    "message.voice.created" -> ChatMessage(
                        eventId, threadId, "🎙 Note vocale", fromAssistant, createdAtMs, deliveryState,
                        kind = "voice", mediaId = mediaId, mime = meta?.optString("mime"),
                    )
                    "media.chunk" -> ChatMessage(
                        eventId, threadId, "", fromAssistant, createdAtMs, deliveryState,
                        kind = "chunk", mediaId = mediaId,
                    )
                    // Appels : le PC demande l'ouverture du composeur — le numéro voyage dans
                    // `mediaId` (champ porteur), la bulle affiche un bouton ACTION_DIAL.
                    "call.dial.requested" -> ChatMessage(
                        eventId, threadId, "📞 Appel proposé : ${meta?.optString("number").orEmpty()}",
                        fromAssistant, createdAtMs, deliveryState,
                        kind = "call", mediaId = meta?.optString("number")?.takeIf { it.isNotBlank() },
                    )
                    else -> ChatMessage(eventId, threadId, "[${decoded.type}]", fromAssistant, createdAtMs, deliveryState)
                }
            }
            else -> ChatMessage(eventId, threadId, String(bytes, Charsets.UTF_8), fromAssistant, createdAtMs, deliveryState)
        }
    }

    private fun decryptBytesOrNull(row: ChatEventRow): ByteArray? {
        val key = epochKeyProvider(row.keyEpoch) ?: return null
        return try {
            val decoder = Base64.getDecoder()
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(TAG_BITS, decoder.decode(row.nonce)))
            cipher.updateAAD(ChatBinaryCodec.encodeHeader(row.toEvent()))
            cipher.doFinal(decoder.decode(row.payloadCiphertext) + decoder.decode(row.authTag))
        } catch (error: Exception) {
            null
        }
    }

    /**
     * W6 — reconstitue les octets d'un média reçu à partir des LIGNES chiffrées du fil (les chunks
     * restent chiffrés au repos dans Room ; le média complet n'existe qu'en mémoire, à l'affichage).
     * Retourne null si méta absente, chunk manquant ou sha256 divergent — jamais un média partiel.
     */
    suspend fun readMediaBytes(threadId: String, mediaId: String): Pair<ByteArray, String>? {
        val rows = dao.readThread(threadId)
        var meta: MediaAssembler.Meta? = null
        val chunks = HashMap<Int, ByteArray>()
        for (row in rows) {
            val bytes = decryptBytesOrNull(row) ?: continue
            val decoded = runCatching { ChatPayloadCodec.decode(bytes) }.getOrNull() as? ChatPayloadCodec.PayloadV2 ?: continue
            val json = runCatching { JSONObject(decoded.metaJson) }.getOrNull() ?: continue
            if (json.optString("mediaId") != mediaId) continue
            when (decoded.type) {
                "message.attachment.created", "message.voice.created" -> {
                    meta = runCatching {
                        MediaAssembler.parseMeta(json.keys().asSequence().associateWith { key -> json.opt(key) })
                    }.getOrNull()
                }
                "media.chunk" -> chunks[json.optInt("index", -1)] = decoded.binary
            }
        }
        val parsed = meta ?: return null
        return runCatching { MediaAssembler.assemble(parsed, chunks) to parsed.mime }.getOrNull()
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
