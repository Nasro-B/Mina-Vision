package fr.mina.gateway

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import fr.mina.gateway.camera.CameraStreamService
import fr.mina.gateway.chat.ChatSettings
import fr.mina.gateway.feature.chat.MinaChatTheme
import fr.mina.gateway.messaging.MessagingExecutors
import fr.mina.gateway.messaging.MinaGatewayService
import fr.mina.gateway.messaging.TelegramGateway
import fr.mina.gateway.messaging.storage.AndroidKeystoreFieldCipher
import fr.mina.gateway.messaging.storage.EncryptedOwnerIdentityStore
import fr.mina.gateway.messaging.storage.MessagingDatabase
import fr.mina.gateway.messaging.storage.RoomMessagingSecretStore
import fr.mina.gateway.transport.DeviceIdentityStore
import org.json.JSONObject

/**
 * Écran d'accueil de l'application téléphone. Ce n'est PAS une page de saisie de jetons : c'est
 * l'entrée vers la conversation (le geste quotidien), avec la configuration de la passerelle
 * SMS/Telegram reléguée en carte secondaire, clairement optionnelle. Compose + le thème partagé
 * MinaChatTheme (noir nuit + ambre, jour/nuit) pour une identité visuelle cohérente avec le chat.
 */
class MainActivity : ComponentActivity() {
    private val homeState = mutableStateOf(HomeUiState())
    private var pendingCameraLens = "front"

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val identity = DeviceIdentityStore(this).createProof("local-pairing-v1")
        writeIdentityProof(identity.deviceId, identity.publicKeySpkiBase64, identity.challenge, identity.signatureBase64)
        homeState.value = homeState.value.copy(
            deviceId = identity.deviceId,
            biometricLock = ChatSettings(this).biometricLockEnabled(),
            biometricAvailable = canAuthenticateBiometric(this),
        )
        setContent {
            val state by homeState
            MinaChatTheme {
                ProvisioningHome(
                    state = state,
                    onPhoneChange = { homeState.value = homeState.value.copy(phone = it) },
                    onTelegramChange = { homeState.value = homeState.value.copy(telegramIds = it) },
                    onOpenChat = { startActivity(Intent(this@MainActivity, ChatActivity::class.java)) },
                    onSave = { token -> provision(state.phone, state.telegramIds, token) },
                    onToggleBiometric = ::setBiometricLock,
                )
            }
        }
        if (!handleCameraIntent(intent)) requestMessagingPermissions()
        loadSavedProvisioningState()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleCameraIntent(intent)
    }

    // Token jamais relu/pré-rempli (écriture seule, comme la phrase de récupération) — seuls
    // numéro/IDs Telegram sont réaffichés, et le statut confirme la présence du token sans l'exposer.
    private fun loadSavedProvisioningState() {
        MessagingExecutors.io.execute {
            val loaded = runCatching {
                val database = MessagingDatabase.open(this)
                val secrets = RoomMessagingSecretStore(database.secretDao(), AndroidKeystoreFieldCipher())
                val identity = EncryptedOwnerIdentityStore(secrets).load()
                Triple(identity, secrets.has(TelegramGateway.BOT_TOKEN_SECRET_NAME), smsPermissionStatus() == "autorisé")
            }.getOrNull()
            runOnUiThread {
                val (identity, hasToken, smsGranted) = loaded ?: Triple(null, false, smsPermissionStatus() == "autorisé")
                homeState.value = homeState.value.copy(
                    phone = identity?.phoneE164 ?: homeState.value.phone,
                    telegramIds = identity?.telegramUserIds?.sorted()?.joinToString(",") ?: homeState.value.telegramIds,
                    hasToken = hasToken,
                    status = provisioningStatusText(
                        ProvisioningState(
                            smsPermissionGranted = smsGranted,
                            hasOwnerIdentity = identity != null,
                            hasTelegramToken = hasToken,
                        ),
                    ),
                    loaded = true,
                )
            }
        }
    }

    private fun provision(phoneValue: String, idsCsv: String, token: CharArray) {
        val idValues = idsCsv.split(',').mapNotNull { it.trim().toLongOrNull() }.toSet()
        homeState.value = homeState.value.copy(status = "Validation et chiffrement…")
        MessagingExecutors.io.execute {
            val result = runCatching {
                val database = MessagingDatabase.open(this)
                val secrets = RoomMessagingSecretStore(database.secretDao(), AndroidKeystoreFieldCipher())
                val identities = EncryptedOwnerIdentityStore(secrets)
                identities.save(phoneValue.trim(), idValues, locallyConfirmed = true)
                if (shouldReplaceTelegramToken(token.size, secrets.has(TelegramGateway.BOT_TOKEN_SECRET_NAME))) {
                    TelegramGateway(requireNotNull(identities.load()), secrets)
                        .provisionToken(token, locallyConfirmed = true)
                }
            }
            token.fill('\u0000')
            runOnUiThread {
                homeState.value = homeState.value.copy(
                    status = result.fold(
                        onSuccess = {
                            restartGatewayService()
                            provisioningStatusText(
                                ProvisioningState(
                                    smsPermissionGranted = smsPermissionStatus() == "autorisé",
                                    hasOwnerIdentity = true,
                                    hasTelegramToken = true,
                                ),
                            )
                        },
                        onFailure = { "Configuration refusée : ${it.message ?: "valeur_invalide"}" },
                    ),
                    hasToken = result.isSuccess || homeState.value.hasToken,
                )
            }
        }
    }

    private fun setBiometricLock(enabled: Boolean) {
        ChatSettings(this).setBiometricLock(enabled)
        homeState.value = homeState.value.copy(biometricLock = enabled)
    }

    private fun requestMessagingPermissions() {
        val requested = buildList {
            add(Manifest.permission.RECEIVE_SMS)
            add(Manifest.permission.SEND_SMS)
            if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
        }
        val missing = requested
            .filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isNotEmpty()) requestPermissions(missing.toTypedArray(), SMS_PERMISSION_REQUEST)
        else startGatewayService()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == SMS_PERMISSION_REQUEST && grantResults.isNotEmpty() &&
            grantResults.all { it == PackageManager.PERMISSION_GRANTED }
        ) startGatewayService()
        if (requestCode == CAMERA_PERMISSION_REQUEST && grantResults.singleOrNull() == PackageManager.PERMISSION_GRANTED) {
            startCameraStream(pendingCameraLens)
        }
    }

    private fun handleCameraIntent(value: Intent?): Boolean = when (value?.action) {
        CameraStreamService.ACTION_START -> {
            pendingCameraLens = if (value.getStringExtra(CameraStreamService.EXTRA_LENS) == "back") "back" else "front"
            if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                startCameraStream(pendingCameraLens)
            } else {
                requestPermissions(arrayOf(Manifest.permission.CAMERA), CAMERA_PERMISSION_REQUEST)
            }
            true
        }
        CameraStreamService.ACTION_STOP -> {
            stopService(Intent(this, CameraStreamService::class.java))
            true
        }
        else -> false
    }

    private fun startCameraStream(lens: String) {
        startForegroundService(Intent(this, CameraStreamService::class.java).apply {
            action = CameraStreamService.ACTION_START
            putExtra(CameraStreamService.EXTRA_LENS, lens)
        })
    }

    private fun startGatewayService() {
        startForegroundService(Intent(this, MinaGatewayService::class.java))
    }

    private fun restartGatewayService() {
        stopService(Intent(this, MinaGatewayService::class.java))
        startGatewayService()
    }

    private fun smsPermissionStatus(): String =
        if (checkSelfPermission(Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED &&
            checkSelfPermission(Manifest.permission.SEND_SMS) == PackageManager.PERMISSION_GRANTED
        ) "autorisé" else "permission requise"

    private fun writeIdentityProof(deviceId: String, publicKey: String, challenge: String, signature: String) {
        openFileOutput("device-identity.json", MODE_PRIVATE).bufferedWriter().use { writer ->
            writer.write(JSONObject().apply {
                put("deviceId", deviceId)
                put("publicKeySpkiBase64", publicKey)
                put("challenge", challenge)
                put("signatureBase64", signature)
            }.toString())
        }
    }

    private companion object {
        const val SMS_PERMISSION_REQUEST = 201
        const val CAMERA_PERMISSION_REQUEST = 202
    }
}

private data class HomeUiState(
    val deviceId: String = "",
    val phone: String = "",
    val telegramIds: String = "",
    val hasToken: Boolean = false,
    val status: String = "Chargement de la configuration…",
    val loaded: Boolean = false,
    val biometricLock: Boolean = false,
    val biometricAvailable: Boolean = false,
)

@Composable
private fun ProvisioningHome(
    state: HomeUiState,
    onPhoneChange: (String) -> Unit,
    onTelegramChange: (String) -> Unit,
    onOpenChat: () -> Unit,
    onSave: (CharArray) -> Unit,
    onToggleBiometric: (Boolean) -> Unit,
) {
    Surface(color = MaterialTheme.colorScheme.background, modifier = Modifier.fillMaxSize()) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .statusBarsPadding()
                .navigationBarsPadding()
                .imePadding()
                .padding(horizontal = 20.dp, vertical = 20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            Header()
            ConversationCard(onOpenChat)
            SecurityCard(state, onToggleBiometric)
            GatewayCard(state, onPhoneChange, onTelegramChange, onSave)
            FooterNote(state.deviceId)
        }
    }
}

@Composable
private fun SecurityCard(state: HomeUiState, onToggleBiometric: (Boolean) -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Verrou biométrique", style = MaterialTheme.typography.titleLarge)
                    Text(
                        if (state.biometricAvailable) {
                            "Exiger ton empreinte ou ton visage pour ouvrir la conversation."
                        } else {
                            "Aucune empreinte enrôlée sur ce téléphone : ajoute-en une dans les réglages Android pour activer le verrou."
                        },
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Spacer(Modifier.size(12.dp))
                Switch(
                    checked = state.biometricLock && state.biometricAvailable,
                    onCheckedChange = { onToggleBiometric(it) },
                    enabled = state.biometricAvailable,
                    modifier = Modifier.semantics { contentDescription = "Activer le verrou biométrique de la conversation" },
                )
            }
        }
    }
}

@Composable
private fun Header() {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Image(
            painter = painterResource(R.mipmap.ic_launcher_round),
            contentDescription = "Logo Mina Vision",
            modifier = Modifier.size(80.dp).clip(CircleShape),
        )
        Text("Mina Vision", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
        Text(
            "Ton assistante, sur ce téléphone.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun ConversationCard(onOpenChat: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Conversation", style = MaterialTheme.typography.titleLarge)
            Text(
                "Parle ou écris à Mina. Tes messages sont chiffrés de bout en bout ; si le PC est éteint, ils partent dès son retour — rien n'est perdu.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Button(
                onClick = onOpenChat,
                modifier = Modifier.fillMaxWidth().heightIn(min = 54.dp)
                    .semantics { contentDescription = "Ouvrir la conversation chiffrée avec Mina" },
            ) { Text("Ouvrir la conversation") }
        }
    }
}

@Composable
private fun GatewayCard(
    state: HomeUiState,
    onPhoneChange: (String) -> Unit,
    onTelegramChange: (String) -> Unit,
    onSave: (CharArray) -> Unit,
) {
    var token by remember { mutableStateOf("") }
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
    ) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Passerelle SMS & Telegram", style = MaterialTheme.typography.titleLarge)
            Text(
                "Optionnel. Permet à Mina de recevoir tes SMS et de répondre via Telegram quand tu es loin du PC. Les secrets restent chiffrés sur ce téléphone.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            OutlinedTextField(
                value = state.phone,
                onValueChange = onPhoneChange,
                label = { Text("Numéro propriétaire E.164") },
                placeholder = { Text("+336…") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone, imeAction = ImeAction.Next),
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = state.telegramIds,
                onValueChange = { onTelegramChange(it.filter { c -> c.isDigit() || c == ',' }) },
                label = { Text("IDs Telegram (numériques, virgules)") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Next),
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = token,
                onValueChange = { token = it },
                label = { Text(if (state.hasToken) "Token BotFather (déjà enregistré)" else "Token BotFather") },
                visualTransformation = PasswordVisualTransformation(),
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                modifier = Modifier.fillMaxWidth(),
            )
            Button(
                onClick = {
                    val chars = token.toCharArray()
                    token = ""
                    onSave(chars)
                },
                modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)
                    .semantics { contentDescription = "Enregistrer la configuration propriétaire Mina Vision, chiffrée localement" },
            ) { Text("Enregistrer et chiffrer") }
            Text(state.status, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun FooterNote(deviceId: String) {
    Text(
        "Appareil appairé : $deviceId\nSecrets chiffrés (Android Keystore + Room). Rien ne quitte ce téléphone en clair.",
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = TextAlign.Center,
    )
}
