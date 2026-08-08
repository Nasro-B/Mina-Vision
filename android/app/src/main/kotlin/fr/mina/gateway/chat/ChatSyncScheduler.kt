package fr.mina.gateway.chat

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.workDataOf

/** Réveil court et opaque : le worker récupère l'état courant, pas le contenu FCM. */
object ChatSyncScheduler {
    private const val UNIQUE_NAME = "mina-chat-sync-now"
    private const val KEY_REASON = "reason"
    private const val KEY_HIGH_WATERMARK = "highWatermark"

    fun enqueueImmediate(context: Context, reason: String, highWatermark: Long) {
        require(reason in setOf("fcm", "fcm_deleted")) { "chat_sync_reason_invalid" }
        require(highWatermark in 0L..9_007_199_254_740_991L) { "chat_sync_watermark_invalid" }
        val request = OneTimeWorkRequestBuilder<ChatSyncWorker>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setInputData(workDataOf(KEY_REASON to reason, KEY_HIGH_WATERMARK to highWatermark))
            .build()
        WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(
            UNIQUE_NAME,
            ExistingWorkPolicy.KEEP,
            request,
        )
    }
}
