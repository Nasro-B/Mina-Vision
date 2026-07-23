package fr.mina.gateway.chat

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Vide la file d'envoi vers le PC, sans jamais perdre ni dupliquer un message.
 *
 * Règles tenues ici :
 *   - un message reste en outbox tant que le PC n'a pas accusé réception — PC éteint, il attend ;
 *   - les tentatives sont espacées exponentiellement, donc un PC absent ne vide pas la batterie ;
 *   - après [MAX_ATTEMPTS] échecs on marque `failed_final` : l'utilisateur voit l'échec au lieu
 *     d'une file qui tourne en silence pour toujours.
 */
class ChatSyncLoop(
    private val dao: ChatDao,
    private val link: DirectChatLink,
    private val scope: CoroutineScope,
    private val now: () -> Long = System::currentTimeMillis,
    private val tickMs: Long = 2_000,
    /** Chemin de secours ; null = direct seul, et l'échec est annoncé comme tel. */
    private val relay: FirebaseChatRelay? = null,
) {
    companion object {
        const val MAX_ATTEMPTS = 12
        private const val BASE_BACKOFF_MS = 3_000L
        private const val MAX_BACKOFF_MS = 5L * 60 * 1_000
        private const val BATCH = 20
    }

    private var job: Job? = null

    fun start() {
        if (job?.isActive == true) return
        job = scope.launch {
            while (isActive) {
                runCatching { drainOnce() }
                delay(tickMs)
            }
        }
    }

    fun stop() {
        job?.cancel()
        job = null
    }

    /** Renvoie le nombre d'envois réellement remis à la socket lors de ce passage. */
    suspend fun drainOnce(): Int {
        val due = dao.dueOutbox(now(), BATCH)
        if (due.isEmpty()) return 0

        if (link.state.value != LinkState.ONLINE) {
            link.connect()
            // Direct indisponible : on tente le relais AVANT de faire attendre. Un message
            // envoyé depuis la 4G doit partir, pas patienter jusqu'au retour sur le Wi-Fi.
            val relayed = relayPending(due)
            due.drop(relayed).forEach { markWaiting(it) }
            return relayed
        }

        var sent = 0
        for (row in due) {
            val event = dao.findEvent(row.eventId)?.toEvent()
            if (event == null) {
                // L'événement a disparu : garder sa ligne d'outbox ne servirait qu'à boucler.
                dao.dequeue(row.eventId)
                continue
            }
            if (link.send(event)) {
                dao.updateDeliveryState(row.eventId, DeliveryState.DIRECT_SENDING)
                dao.rescheduleOutbox(row.eventId, row.attemptCount + 1, now() + backoff(row.attemptCount), null)
                sent += 1
            } else {
                markWaiting(row)
            }
        }
        return sent
    }

    /**
     * Dépose par le relais ce qui peut l'être. Retourne le nombre RÉELLEMENT déposé : un échec
     * silencieux compté comme succès ferait disparaître le message de la file sans qu'il parte.
     */
    private suspend fun relayPending(rows: List<OutboxRow>): Int {
        val relayLink = relay ?: return 0
        if (!relayLink.isReady()) return 0
        var sent = 0
        for (row in rows) {
            val event = dao.findEvent(row.eventId)?.toEvent() ?: continue
            val accepted = kotlinx.coroutines.suspendCancellableCoroutine { continuation ->
                relayLink.send(event) { ok -> continuation.resume(ok) { _, _, _ -> } }
            }
            if (!accepted) break
            dao.updateDeliveryState(row.eventId, DeliveryState.CLOUD_QUEUED)
            dao.rescheduleOutbox(row.eventId, row.attemptCount + 1, now() + backoff(row.attemptCount), null)
            sent += 1
        }
        return sent
    }

    private suspend fun markWaiting(row: OutboxRow) {
        val attempts = row.attemptCount + 1
        if (attempts >= MAX_ATTEMPTS) {
            dao.updateDeliveryState(row.eventId, DeliveryState.FAILED_FINAL)
            dao.dequeue(row.eventId)
            return
        }
        dao.updateDeliveryState(row.eventId, DeliveryState.WAITING_FOR_PC)
        dao.rescheduleOutbox(
            eventId = row.eventId,
            attempts = attempts,
            nextAtMs = now() + backoff(row.attemptCount),
            error = link.lastError() ?: "PC injoignable",
        )
    }

    private fun backoff(attempts: Int): Long =
        minOf(MAX_BACKOFF_MS, BASE_BACKOFF_MS shl minOf(attempts, 10))
}
