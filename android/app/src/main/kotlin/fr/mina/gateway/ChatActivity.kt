package fr.mina.gateway

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import fr.mina.gateway.chat.ChatEngine
import fr.mina.gateway.chat.ChatNotifier
import fr.mina.gateway.feature.chat.ChatRoute

/** Écran de conversation avec Mina — le cœur de l'application côté téléphone. */
class ChatActivity : ComponentActivity() {
    private var visible = false

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        ChatNotifier.ensureChannel(this)
        // Notification seulement quand l'écran n'est PAS devant les yeux : prévenir pour un
        // message déjà visible serait du bruit.
        ChatEngine.get(this).onAssistantMessage = { message ->
            if (!visible) ChatNotifier.notifyReply(applicationContext, message.text)
        }
        setContent { ChatRoute() }
    }

    override fun onStart() {
        super.onStart()
        visible = true
    }

    override fun onStop() {
        visible = false
        super.onStop()
    }
}
