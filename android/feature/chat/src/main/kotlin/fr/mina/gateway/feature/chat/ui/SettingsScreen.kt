package fr.mina.gateway.feature.chat.ui

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import fr.mina.gateway.chat.ChatPrivacySettings
import fr.mina.gateway.chat.ChatPrivacySettingsStore
import fr.mina.gateway.chat.ChatSettings
import fr.mina.gateway.feature.chat.ChatNotificationPermissionStatus
import fr.mina.gateway.feature.chat.NotificationPermissionCoordinator
import kotlinx.coroutines.launch

@Composable
fun SettingsScreen(
    onOpenGateway: () -> Unit,
    onOpenDevices: () -> Unit,
    onBack: () -> Unit,
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val privacyStore = remember(context) { ChatPrivacySettingsStore(context) }
    val privacySettings by privacyStore.settings.collectAsStateWithLifecycle(ChatPrivacySettings())
    var paired by remember { mutableStateOf(ChatSettings(context).isPaired()) }
    var notificationGranted by remember { mutableStateOf(notificationPermissionGranted(context)) }
    var privacyError by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val notificationPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        notificationGranted = granted
        if (!granted && notificationPermissionRationale(context)) {
            scope.launch {
                try {
                    privacyStore.markNotificationRefusalObserved()
                } catch (_: Exception) {
                    privacyError = "Impossible d’enregistrer votre choix de notifications."
                }
            }
        }
    }
    val notificationStatus = NotificationPermissionCoordinator.status(
        apiLevel = Build.VERSION.SDK_INT,
        paired = paired,
        granted = notificationGranted,
        promptAttempted = privacySettings.notificationPromptAttempted,
        refusalObserved = privacySettings.notificationRefusalObserved,
        shouldShowRationale = notificationPermissionRationale(context),
    )

    DisposableEffect(context, lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                paired = ChatSettings(context).isPaired()
                notificationGranted = notificationPermissionGranted(context)
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    fun requestNotifications() {
        scope.launch {
            privacyError = null
            try {
                privacyStore.markNotificationPromptAttempted()
                notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
            } catch (_: Exception) {
                privacyError = "Impossible d’enregistrer votre choix de notifications."
            }
        }
    }

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
            Text("Notifications privées", style = MaterialTheme.typography.titleMedium)
            Text(
                "Par défaut, seule l’indication « Mina a répondu » est visible. Aucun texte de conversation n’entre dans la notification.",
                style = MaterialTheme.typography.bodyMedium,
                textAlign = TextAlign.Center,
            )
            when (notificationStatus) {
                ChatNotificationPermissionStatus.NOT_REQUIRED -> Text(
                    "Ce téléphone ne requiert pas de permission runtime pour les notifications.",
                    style = MaterialTheme.typography.bodyMedium,
                    textAlign = TextAlign.Center,
                )
                ChatNotificationPermissionStatus.PAIRING_REQUIRED -> Text(
                    "Appairez d’abord le PC : aucune permission de notification n’est demandée avant l’appairage.",
                    style = MaterialTheme.typography.bodyMedium,
                    textAlign = TextAlign.Center,
                )
                ChatNotificationPermissionStatus.GRANTED -> Text(
                    "Notifications privées activées.",
                    style = MaterialTheme.typography.bodyMedium,
                    textAlign = TextAlign.Center,
                )
                ChatNotificationPermissionStatus.REQUESTABLE -> Button(
                    onClick = ::requestNotifications,
                    modifier = Modifier.fillMaxWidth().semantics {
                        contentDescription = "Activer les notifications privées"
                    },
                ) { Text("Activer les notifications privées") }
                ChatNotificationPermissionStatus.DENIED -> {
                    Text(
                        "Notifications non activées : le chat et la synchronisation continuent sans alerte visible.",
                        style = MaterialTheme.typography.bodyMedium,
                        textAlign = TextAlign.Center,
                    )
                    TextButton(onClick = ::requestNotifications) { Text("Réessayer") }
                }
                ChatNotificationPermissionStatus.DENIED_PERMANENTLY -> {
                    Text(
                        "Android ne présente plus le dialogue de notification : le chat et la synchronisation continuent sans alerte visible.",
                        style = MaterialTheme.typography.bodyMedium,
                        textAlign = TextAlign.Center,
                    )
                    TextButton(onClick = { openNotificationSettings(context) }) {
                        Text("Ouvrir les réglages Android")
                    }
                }
            }
            privacyError?.let { error ->
                Text(error, style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.Center)
            }
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

private fun notificationPermissionGranted(context: android.content.Context): Boolean =
    Build.VERSION.SDK_INT < 33 ||
        context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

private fun notificationPermissionRationale(context: android.content.Context): Boolean =
    Build.VERSION.SDK_INT >= 33 &&
        (context as? Activity)?.shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS) == true

private fun openNotificationSettings(context: android.content.Context) {
    context.startActivity(
        Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName),
    )
}
