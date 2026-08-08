package fr.mina.gateway.feature.chat.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

@Composable
fun SettingsScreen(
    onOpenGateway: () -> Unit,
    onOpenDevices: () -> Unit,
    onBack: () -> Unit,
) {
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
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text("Réglages", style = MaterialTheme.typography.headlineSmall)
            Text(
                "Les secrets de passerelle restent chiffrés dans Android Keystore et ne sont jamais affichés après enregistrement.",
                style = MaterialTheme.typography.bodyMedium,
                textAlign = TextAlign.Center,
            )
            Button(
                onClick = onOpenGateway,
                modifier = Modifier.fillMaxWidth().semantics {
                    contentDescription = "Ouvrir la passerelle SMS et Telegram"
                },
            ) { Text("Passerelle SMS & Telegram") }
            TextButton(
                onClick = onOpenDevices,
                modifier = Modifier.semantics {
                    contentDescription = "Afficher les appareils associés en lecture seule"
                },
            ) { Text("Appareils associés") }
        }
    }
}
