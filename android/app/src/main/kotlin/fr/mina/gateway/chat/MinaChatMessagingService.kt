package fr.mina.gateway.chat

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * Réveil PUSH : quand le PC a une réponse et que l'app est fermée, un message de DONNÉES Firebase
 * réveille ce service qui planifie une synchro unique seulement après validation de la session et du
 * signal opaque. Le push ne transporte JAMAIS de contenu ; le contenu chiffré est tiré ensuite par
 * le relais habituel.
 */
class MinaChatMessagingService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        // Le push est un signal opaque. Sans session Firebase owner/device valide, il est ignoré.
        val engine = ChatEngine.get(applicationContext)
        engine.resolveFcmSyncTarget { target ->
            val signal = target?.let { FcmSyncSignal.parse(message.data, it) } ?: return@resolveFcmSyncTarget
            ChatSyncScheduler.enqueueImmediate(applicationContext, "fcm", signal.highWatermark)
        }
    }

    override fun onDeletedMessages() {
        val engine = ChatEngine.get(applicationContext)
        engine.resolveFcmSyncTarget { target ->
            if (target != null) ChatSyncScheduler.enqueueImmediate(applicationContext, "fcm_deleted", 0L)
        }
    }
}
