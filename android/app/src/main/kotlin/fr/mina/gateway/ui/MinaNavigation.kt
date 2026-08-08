package fr.mina.gateway.ui

import android.content.Intent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import fr.mina.gateway.ChatActivity
import fr.mina.gateway.feature.chat.ui.ConversationListScreen
import fr.mina.gateway.feature.chat.ui.DeviceScreen
import fr.mina.gateway.feature.chat.ui.SettingsScreen

const val ROUTE_CONVERSATIONS = "conversations"
private const val ROUTE_CHAT = "chat/{threadId}"
private const val ROUTE_VOICE = "voice/{threadId}"
private const val ROUTE_DEVICES = "devices"
private const val ROUTE_SETTINGS = "settings"
private const val ROUTE_GATEWAY = "gateway"

@Composable
fun MinaNavigation(
    gatewayContent: @Composable (onOpenChat: () -> Unit) -> Unit,
) {
    val navigation = rememberNavController()
    NavHost(navController = navigation, startDestination = ROUTE_CONVERSATIONS) {
        composable(ROUTE_CONVERSATIONS) {
            ConversationListScreen(
                onOpenConversation = { threadId -> navigation.navigate("chat/$threadId") },
                onOpenGateway = { navigation.navigate(ROUTE_GATEWAY) },
                onOpenSettings = { navigation.navigate(ROUTE_SETTINGS) },
            )
        }
        composable(ROUTE_CHAT) {
            SecureChatActivityLauncher(onLaunched = navigation::popBackStack)
        }
        composable(ROUTE_VOICE) {
            VoicePendingScreen(onBack = navigation::popBackStack)
        }
        composable(ROUTE_DEVICES) {
            DeviceScreen(onBack = navigation::popBackStack)
        }
        composable(ROUTE_SETTINGS) {
            SettingsScreen(
                onOpenGateway = { navigation.navigate(ROUTE_GATEWAY) },
                onOpenDevices = { navigation.navigate(ROUTE_DEVICES) },
                onBack = navigation::popBackStack,
            )
        }
        composable(ROUTE_GATEWAY) {
            gatewayContent { navigation.navigate("chat/main") }
        }
    }
}

/**
 * ChatActivity reste l'unique frontière du chat car elle porte le verrou biométrique. La route
 * Compose conserve son contrat pour les futurs fils synchronisés sans ouvrir les messages avant
 * l'authentification locale.
 */
@Composable
private fun SecureChatActivityLauncher(onLaunched: () -> Unit) {
    val context = LocalContext.current
    LaunchedEffect(Unit) {
        context.startActivity(Intent(context, ChatActivity::class.java))
        onLaunched()
    }
}

@Composable
private fun VoicePendingScreen(onBack: () -> Unit) {
    Scaffold(
        topBar = {
            TextButton(onClick = onBack, modifier = Modifier.semantics {
                contentDescription = "Revenir aux conversations"
            }) { Text("Retour") }
        },
    ) { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding).padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text("Voix live en préparation", style = MaterialTheme.typography.titleLarge)
            Text(
                "Cette route est réservée au transport vocal chiffré. Elle ne démarre ni micro ni réseau tant que la tâche voix live n'est pas terminée.",
                style = MaterialTheme.typography.bodyMedium,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 12.dp),
            )
        }
    }
}
