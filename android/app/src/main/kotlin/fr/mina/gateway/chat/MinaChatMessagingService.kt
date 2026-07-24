package fr.mina.gateway.chat

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Réveil PUSH : quand le PC a une réponse et que l'app est fermée, un message de DONNÉES Firebase
 * réveille ce service qui déclenche une synchro unique. Le push ne transporte JAMAIS de contenu —
 * seulement le signal « il y a quelque chose à récupérer » ; le contenu chiffré est tiré ensuite par
 * le relais habituel. Sûr si aucun PC n'est appairé (syncOnce sort tôt).
 */
class MinaChatMessagingService : FirebaseMessagingService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onMessageReceived(message: RemoteMessage) {
        // On ignore toute charge de notification ; seul le signal compte. Le contenu ne transite pas ici.
        scope.launch {
            runCatching { ChatEngine.get(applicationContext).syncOnce() }
        }
    }

    override fun onNewToken(token: String) {
        // Le jeton FCM permettra au PC de cibler ce téléphone. Il n'est pas sensible en soi ; la
        // synchro périodique reste le filet si le token n'est pas encore remonté au PC.
        ChatSyncWorker.ensureScheduled(applicationContext)
    }
}
