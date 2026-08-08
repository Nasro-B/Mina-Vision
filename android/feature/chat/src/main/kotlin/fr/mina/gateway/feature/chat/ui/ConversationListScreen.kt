package fr.mina.gateway.feature.chat.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

/** Première liste volontairement bornée : le moteur actuel n'expose encore qu'un fil canonique. */
@Composable
@OptIn(ExperimentalMaterial3Api::class)
fun ConversationListScreen(
    onOpenConversation: (String) -> Unit,
    onOpenGateway: () -> Unit,
    onOpenSettings: () -> Unit,
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Mina Vision") },
                actions = {
                    TextButton(onClick = onOpenSettings) { Text("Réglages") }
                },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text("Conversations", style = MaterialTheme.typography.headlineSmall)
            Button(
                onClick = { onOpenConversation("main") },
                modifier = Modifier.fillMaxWidth().semantics {
                    contentDescription = "Ouvrir la conversation avec Mina"
                },
            ) {
                Column(horizontalAlignment = Alignment.Start, modifier = Modifier.fillMaxWidth()) {
                    Text("Conversation avec Mina", style = MaterialTheme.typography.titleMedium)
                    Text("Message local chiffré, PC prioritaire", style = MaterialTheme.typography.bodyMedium)
                }
            }
            Text(
                "Le multi-fils arrive avec l'historique synchronisé. Aucun titre de fil n'est encore chargé depuis Firebase.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            TextButton(onClick = onOpenGateway) { Text("Configurer la passerelle SMS & Telegram") }
        }
    }
}
