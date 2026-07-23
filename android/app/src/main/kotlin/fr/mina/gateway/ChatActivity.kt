package fr.mina.gateway

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import fr.mina.gateway.feature.chat.ChatRoute

/** Écran de conversation avec Mina — le cœur de l'application côté téléphone. */
class ChatActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent { ChatRoute() }
    }
}
