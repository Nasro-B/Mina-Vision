package fr.mina.gateway.chat

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.app.NotificationManagerCompat
import fr.mina.gateway.ChatActivity

/**
 * Notification à l'arrivée d'une réponse de Mina.
 *
 * Aucun texte déchiffré n'entre dans la notification ou son historique système. L'utilisateur
 * ouvre Mina pour lire la réponse dans le coffre local.
 */
object ChatNotifier {
    private const val CHANNEL_ID = "mina_chat_replies"
    private const val NOTIFICATION_ID = 4_201

    fun ensureChannel(context: Context) {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Réponses de Mina",
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = "Prévient quand Mina répond depuis le PC."
            enableVibration(true)
        }
        context.getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)
    }

    fun notifyReply(context: Context, preview: String) {
        // Permission refusée : on ne notifie pas, et on ne prétend pas l'avoir fait.
        if (context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED
        ) return

        val open = PendingIntent.getActivity(
            context,
            0,
            Intent(context, ChatActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notification = Notification.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_email)
            .setContentTitle("Mina")
            .setContentText("Mina a répondu")
            .setStyle(Notification.BigTextStyle().bigText("Ouvre Mina pour lire la réponse."))
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification)
    }
}
