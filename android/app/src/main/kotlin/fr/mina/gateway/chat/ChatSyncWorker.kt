package fr.mina.gateway.chat

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/**
 * Filet de sécurité périodique : même sans push, l'app draine l'outbox et laisse le relais récupérer
 * les réponses de Mina en arrière-plan. Léger et borné — WorkManager impose déjà un minimum de 15 min
 * et respecte la batterie. Ne fait rien tant qu'aucun PC n'est appairé (syncOnce sort tôt).
 */
class ChatSyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = runCatching {
        ChatEngine.get(applicationContext).syncOnce()
        Result.success()
    }.getOrElse { Result.retry() }

    companion object {
        private const val UNIQUE_NAME = "mina-chat-sync"

        /** Programme la synchro périodique (idempotent : conserve la planification existante). */
        fun ensureScheduled(context: Context) {
            val request = PeriodicWorkRequestBuilder<ChatSyncWorker>(15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                UNIQUE_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                request,
            )
        }
    }
}
