package fr.mina.gateway.chat

import androidx.room.ColumnInfo
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.RoomDatabase
import androidx.room.Transaction
import kotlinx.coroutines.flow.Flow

/**
 * Stockage local du chat — CIPHERTEXT UNIQUEMENT.
 *
 * Room ne voit jamais un texte en clair : chaque ligne porte l'enveloppe chiffrée telle qu'elle
 * circule sur le réseau. Le déchiffrement se fait en mémoire, à la demande, avec la clé
 * d'époque. Conséquence voulue : une copie du fichier de base ne révèle rien sans les clés du
 * Keystore, et le contenu reste protégé même si le sandbox de l'application est exfiltré.
 */
@Entity(tableName = "chat_events")
data class ChatEventRow(
    @PrimaryKey @ColumnInfo(name = "event_id") val eventId: String,
    @ColumnInfo(name = "thread_id") val threadId: String,
    @ColumnInfo(name = "sender_device_id") val senderDeviceId: String,
    @ColumnInfo(name = "device_sequence") val deviceSequence: Long,
    @ColumnInfo(name = "key_epoch") val keyEpoch: Int,
    @ColumnInfo(name = "routing_class") val routingClass: String,
    @ColumnInfo(name = "created_at_ms") val createdAtMs: Long,
    @ColumnInfo(name = "expires_at_ms") val expiresAtMs: Long,
    @ColumnInfo(name = "payload_ciphertext") val payloadCiphertext: String,
    val nonce: String,
    @ColumnInfo(name = "auth_tag") val authTag: String,
    val signature: String,
    /** État de livraison local — jamais envoyé, il ne concerne que cet appareil. */
    @ColumnInfo(name = "delivery_state") val deliveryState: String,
    /** Vrai si l'événement vient de Mina (PC) plutôt que de cet appareil. */
    @ColumnInfo(name = "from_assistant") val fromAssistant: Boolean,
)

/**
 * File d'envoi DURABLE. Un message écrit hors ligne reste ici jusqu'à l'accusé du PC : c'est
 * ce qui permet d'écrire à Mina PC éteint sans jamais perdre le message.
 */
@Entity(tableName = "chat_outbox")
data class OutboxRow(
    @PrimaryKey @ColumnInfo(name = "event_id") val eventId: String,
    @ColumnInfo(name = "thread_id") val threadId: String,
    @ColumnInfo(name = "queued_at_ms") val queuedAtMs: Long,
    @ColumnInfo(name = "attempt_count") val attemptCount: Int,
    @ColumnInfo(name = "next_attempt_at_ms") val nextAttemptAtMs: Long,
    @ColumnInfo(name = "last_error") val lastError: String?,
)

@Entity(tableName = "chat_threads")
data class ThreadRow(
    @PrimaryKey @ColumnInfo(name = "thread_id") val threadId: String,
    /** Titre CHIFFRÉ : même le nom d'une conversation ne fuit pas. */
    @ColumnInfo(name = "title_ciphertext") val titleCiphertext: String?,
    @ColumnInfo(name = "updated_at_ms") val updatedAtMs: Long,
    val archived: Boolean,
)

@Dao
interface ChatDao {
    @Query(
        """
        SELECT * FROM (
            SELECT * FROM chat_events
            WHERE thread_id = :threadId
              AND routing_class != 'stream'
              AND (from_assistant = 0 OR delivery_state != 'response_streaming')
            ORDER BY created_at_ms DESC, event_id DESC
            LIMIT :limit
        )
        ORDER BY created_at_ms ASC, event_id ASC
        """,
    )
    fun observeThread(threadId: String, limit: Int): Flow<List<ChatEventRow>>

    @Query(
        """
        SELECT * FROM chat_events
        WHERE thread_id = :threadId
          AND routing_class != 'stream'
          AND (from_assistant = 0 OR delivery_state != 'response_streaming')
          AND (
            created_at_ms < :beforeCreatedAtMs
            OR (created_at_ms = :beforeCreatedAtMs AND event_id < :beforeEventId)
          )
        ORDER BY created_at_ms DESC, event_id DESC
        LIMIT :limit
        """,
    )
    suspend fun readVisibleThreadBefore(
        threadId: String,
        beforeCreatedAtMs: Long,
        beforeEventId: String,
        limit: Int,
    ): List<ChatEventRow>

    @Query("SELECT * FROM chat_events WHERE thread_id = :threadId ORDER BY created_at_ms ASC, event_id ASC")
    suspend fun readThread(threadId: String): List<ChatEventRow>

    @Query("SELECT * FROM chat_events WHERE event_id = :eventId")
    suspend fun findEvent(eventId: String): ChatEventRow?

    /**
     * IGNORE et non REPLACE : un événement est append-only. Recevoir deux fois le même
     * eventId (retransmission réseau) ne doit RIEN changer — c'est la déduplication qui
     * garantit « une seule réponse visible » quand direct et Firebase livrent tous les deux.
     */
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertEvent(row: ChatEventRow): Long

    @Query("UPDATE chat_events SET delivery_state = :state WHERE event_id = :eventId")
    suspend fun updateDeliveryState(eventId: String, state: String)

    /**
     * C2 — rétention 14 j des médias : purge les CHUNKS binaires (routing_class = 'stream') plus
     * vieux que la coupure. Les bulles (méta) restent : après purge, l'app dit honnêtement
     * « incomplète ou illisible » au lieu de faire disparaître l'historique.
     */
    @Query("DELETE FROM chat_events WHERE routing_class = 'stream' AND created_at_ms < :beforeMs")
    suspend fun purgeExpiredChunks(beforeMs: Long): Int

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun enqueue(row: OutboxRow): Long

    @Query("SELECT * FROM chat_outbox WHERE next_attempt_at_ms <= :nowMs ORDER BY queued_at_ms ASC, event_id ASC LIMIT :limit")
    suspend fun dueOutbox(nowMs: Long, limit: Int): List<OutboxRow>

    @Query("SELECT COUNT(*) FROM chat_outbox")
    suspend fun outboxSize(): Int

    @Query("DELETE FROM chat_outbox WHERE event_id = :eventId")
    suspend fun dequeue(eventId: String)

    @Query("UPDATE chat_outbox SET attempt_count = :attempts, next_attempt_at_ms = :nextAtMs, last_error = :error WHERE event_id = :eventId")
    suspend fun rescheduleOutbox(eventId: String, attempts: Int, nextAtMs: Long, error: String?)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertThread(row: ThreadRow)

    @Query("SELECT * FROM chat_threads WHERE archived = 0 ORDER BY updated_at_ms DESC")
    fun observeThreads(): Flow<List<ThreadRow>>

    /**
     * Écrit l'événement ET sa ligne d'outbox dans la MÊME transaction : sans cela, un crash
     * entre les deux écritures laisserait un message soit invisible, soit jamais envoyé.
     */
    @Transaction
    suspend fun enqueueOutgoing(event: ChatEventRow, outbox: OutboxRow) {
        insertEvent(event)
        enqueue(outbox)
    }

    /** Remet un échec final dans la même outbox, sans jamais créer un second événement. */
    @Transaction
    suspend fun retryFailedOutgoing(eventId: String, nowMs: Long): Boolean {
        return retryFailedOutgoingBatch(listOf(eventId), nowMs)
    }

    /** Remet un groupe média échoué en file dans une seule transaction. */
    @Transaction
    suspend fun retryFailedOutgoingBatch(eventIds: List<String>, nowMs: Long): Boolean {
        if (eventIds.isEmpty()) return false
        val events = eventIds.map { findEvent(it) ?: return false }
        if (events.any { it.fromAssistant || it.deliveryState != DeliveryState.FAILED_FINAL }) return false
        for (event in events) {
            enqueue(
                OutboxRow(
                    eventId = event.eventId,
                    threadId = event.threadId,
                    queuedAtMs = nowMs,
                    attemptCount = 0,
                    nextAttemptAtMs = nowMs,
                    lastError = null,
                ),
            )
            rescheduleOutbox(event.eventId, attempts = 0, nextAtMs = nowMs, error = null)
            updateDeliveryState(event.eventId, DeliveryState.LOCAL_PENDING)
        }
        return true
    }
}

@Database(
    entities = [ChatEventRow::class, OutboxRow::class, ThreadRow::class],
    version = 1,
    exportSchema = true,
)
abstract class ChatDatabase : RoomDatabase() {
    abstract fun chatDao(): ChatDao

    companion object {
        const val NAME = "mina-chat.db"
    }
}
