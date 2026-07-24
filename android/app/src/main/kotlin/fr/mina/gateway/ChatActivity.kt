package fr.mina.gateway

import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.fragment.app.FragmentActivity
import fr.mina.gateway.chat.ChatEngine
import fr.mina.gateway.chat.ChatNotifier
import fr.mina.gateway.chat.ChatSettings
import fr.mina.gateway.feature.chat.ChatRoute
import fr.mina.gateway.feature.chat.MinaChatTheme

/** Écran de conversation avec Mina — le cœur de l'application côté téléphone. */
class ChatActivity : FragmentActivity() {
    private var visible = false
    private val unlocked = mutableStateOf(false)

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        ChatNotifier.ensureChannel(this)
        // Notification seulement quand l'écran n'est PAS devant les yeux : prévenir pour un
        // message déjà visible serait du bruit.
        ChatEngine.get(this).onAssistantMessage = { message ->
            if (!visible) ChatNotifier.notifyReply(applicationContext, message.text)
        }
        val lockEnabled = ChatSettings(this).biometricLockEnabled()
        val canAuth = canAuthenticateBiometric(this)
        setContent {
            val isUnlocked by unlocked
            if (BiometricGate.isLocked(lockEnabled, canAuth, isUnlocked)) {
                MinaChatTheme { BiometricLockScreen(onUnlock = ::requestUnlock) }
            } else {
                ChatRoute()
            }
        }
        if (BiometricGate.isLocked(lockEnabled, canAuth, unlocked.value)) requestUnlock()
    }

    private fun requestUnlock() {
        promptBiometricUnlock(this) { ok -> if (ok) unlocked.value = true }
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

@Composable
private fun BiometricLockScreen(onUnlock: () -> Unit) {
    Surface(color = MaterialTheme.colorScheme.background, modifier = Modifier.fillMaxSize()) {
        Column(
            Modifier.fillMaxSize().padding(32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text("Conversation verrouillée", style = MaterialTheme.typography.titleLarge)
            Spacer(Modifier.size(8.dp))
            Text(
                "Déverrouille avec ton empreinte ou ton visage pour voir tes messages.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.size(20.dp))
            Button(onClick = onUnlock) { Text("Déverrouiller") }
        }
    }
}
