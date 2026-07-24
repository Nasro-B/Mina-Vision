package fr.mina.gateway.feature.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.platform.LocalContext
import fr.mina.gateway.feature.voice.DictationState
import fr.mina.gateway.feature.voice.VoiceDictation
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import fr.mina.gateway.chat.ChatMessage
import fr.mina.gateway.chat.DeliveryState
import fr.mina.gateway.chat.LinkState
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun ChatRoute(viewModel: ChatViewModel = viewModel()) {
    val messages by viewModel.messages.collectAsStateWithLifecycle()
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    MinaChatTheme {
        if (!state.paired) {
            PairingScreen(
                deviceId = viewModel.deviceId(),
                defaultPort = viewModel.defaultPort(),
                error = state.sendError,
                onPair = viewModel::pair,
            )
        } else {
            ChatScreen(
                messages = messages,
                state = state,
                onSend = viewModel::send,
                onSendImage = viewModel::sendImage,
                onSendVoice = viewModel::sendVoice,
                onRetry = viewModel::retryLink,
                onDismissError = viewModel::dismissSendError,
                onUnpair = viewModel::unpair,
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(
    messages: List<ChatMessage>,
    state: ChatUiState,
    onSend: (String) -> Unit,
    onSendImage: (android.net.Uri) -> Unit,
    onSendVoice: (ByteArray) -> Unit,
    onRetry: () -> Unit,
    onDismissError: () -> Unit,
    onUnpair: () -> Unit,
) {
    val listState = rememberLazyListState()
    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) listState.animateScrollToItem(messages.lastIndex)
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                title = { Text("Mina") },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface,
                    titleContentColor = MaterialTheme.colorScheme.onSurface,
                ),
                actions = {
                    TextButton(onClick = onUnpair) { Text("Désappairer") }
                },
            )
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            LinkBanner(state = state, onRetry = onRetry)

            if (messages.isEmpty()) {
                EmptyConversation(Modifier.weight(1f))
            } else {
                LazyColumn(
                    state = listState,
                    modifier = Modifier.weight(1f).fillMaxWidth(),
                    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    items(messages, key = { it.eventId }) { message -> MessageBubble(message) }
                }
            }

            state.sendError?.let { error ->
                ErrorStrip(text = error, onDismiss = onDismissError)
            }

            Composer(onSend = onSend, onSendImage = onSendImage, onSendVoice = onSendVoice)
        }
    }
}

@Composable
private fun LinkBanner(state: ChatUiState, onRetry: () -> Unit) {
    val (label, detail) = when (state.link) {
        LinkState.ONLINE -> "PC connecté" to null
        LinkState.CONNECTING -> "Connexion au PC…" to null
        LinkState.REFUSED -> "PC a refusé cet appareil" to (state.linkError ?: "appairage à refaire")
        LinkState.OFFLINE -> "PC injoignable" to (state.linkError ?: "Mina répondra au retour du PC")
    }
    val online = state.link == LinkState.ONLINE
    Surface(
        color = if (online) MaterialTheme.colorScheme.surface else MaterialTheme.colorScheme.surfaceVariant,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(horizontal = 16.dp, vertical = 10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier
                        .size(8.dp)
                        .background(
                            color = when (state.link) {
                                LinkState.ONLINE -> MaterialTheme.colorScheme.primary
                                LinkState.REFUSED -> MaterialTheme.colorScheme.error
                                else -> MaterialTheme.colorScheme.onSurfaceVariant
                            },
                            shape = CircleShape,
                        )
                        // L'état ne passe pas que par la couleur : il est aussi écrit.
                        .semantics { contentDescription = label },
                )
                Spacer(Modifier.size(8.dp))
                Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurface)
                Spacer(Modifier.weight(1f))
                if (state.pendingCount > 0) {
                    Text(
                        "${state.pendingCount} en attente",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (!online) {
                    TextButton(onClick = onRetry) { Text("Réessayer") }
                }
            }
            detail?.let {
                Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outline)
}

@Composable
private fun EmptyConversation(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.padding(32.dp),
        ) {
            Text(
                "Aucun message",
                style = MaterialTheme.typography.titleLarge,
                color = MaterialTheme.colorScheme.onBackground,
            )
            Spacer(Modifier.size(8.dp))
            Text(
                "Écrivez à Mina. Si le PC est éteint, le message part dès son retour — il n'est pas perdu et personne d'autre n'y répond.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }
    }
}

@Composable
private fun MessageBubble(message: ChatMessage) {
    val mine = !message.fromAssistant
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start,
    ) {
        Surface(
            color = if (mine) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant,
            contentColor = if (mine) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurface,
            shape = RoundedCornerShape(
                topStart = 16.dp,
                topEnd = 16.dp,
                bottomStart = if (mine) 16.dp else 4.dp,
                bottomEnd = if (mine) 4.dp else 16.dp,
            ),
            modifier = Modifier.widthIn(max = 300.dp),
        ) {
            Column(Modifier.padding(horizontal = 14.dp, vertical = 10.dp)) {
                Text(message.text, style = MaterialTheme.typography.bodyLarge)
                Spacer(Modifier.size(4.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        clockOf(message.createdAtMs),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (mine) {
                        Spacer(Modifier.size(8.dp))
                        Text(
                            deliveryLabel(message.deliveryState),
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }
}

/** Libellés d'état honnêtes : « envoyé » ne s'affiche que quand le PC a accusé réception. */
private fun deliveryLabel(state: String): String = when (state) {
    DeliveryState.LOCAL_PENDING -> "en file"
    DeliveryState.DIRECT_SENDING -> "envoi…"
    DeliveryState.CLOUD_QUEUED -> "via cloud"
    DeliveryState.WAITING_FOR_PC -> "attend le PC"
    DeliveryState.PC_RECEIVED -> "reçu par le PC"
    DeliveryState.PROCESSING -> "Mina réfléchit"
    DeliveryState.RESPONSE_STREAMING -> "Mina répond"
    DeliveryState.COMPLETED -> "répondu"
    DeliveryState.RETRY_WAIT -> "nouvel essai"
    DeliveryState.FAILED_FINAL -> "échec"
    else -> state
}

private fun clockOf(atMs: Long): String =
    SimpleDateFormat("HH:mm", Locale.FRANCE).format(Date(atMs))

@Composable
private fun ErrorStrip(text: String, onDismiss: () -> Unit) {
    Surface(color = MaterialTheme.colorScheme.error, contentColor = Color.White, modifier = Modifier.fillMaxWidth()) {
        Row(
            Modifier.padding(start = 16.dp, end = 8.dp, top = 8.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(text, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
            TextButton(onClick = onDismiss) { Text("OK", color = Color.White) }
        }
    }
}

@Composable
private fun Composer(
    onSend: (String) -> Unit,
    onSendImage: (android.net.Uri) -> Unit,
    onSendVoice: (ByteArray) -> Unit,
) {
    var draft by remember { mutableStateOf("") }
    var dictationNote by remember { mutableStateOf<String?>(null) }
    var listening by remember { mutableStateOf(false) }
    var recording by remember { mutableStateOf(false) }
    val context = LocalContext.current
    val dictation = remember { VoiceDictation(context) }
    val recorder = remember { VoiceNoteRecorder(context) }
    DisposableEffect(Unit) { onDispose { dictation.stop(); recorder.cancel() } }

    // Sélecteur de photo « moderne » (PickVisualMedia) : aucune permission de stockage requise,
    // l'utilisateur choisit une image, elle est préparée (redimensionnée, EXIF retiré) puis envoyée.
    val imagePicker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) onSendImage(uri)
    }

    // La permission micro est demandée au moment du besoin, jamais au lancement : Mina n'écoute
    // que si Nasro appuie sur le micro.
    val micPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (!granted) dictationNote = "Permission micro refusée : la dictée reste indisponible."
        else {
            listening = true
            dictation.start { state -> handleDictation(state, { draft = it }, { listening = it }, { dictationNote = it }) }
        }
    }

    // Permission distincte pour la NOTE VOCALE (envoi de l'audio lui-même, pas de la dictée texte).
    val recordPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (!granted) { dictationNote = "Permission micro refusée : note vocale impossible."; return@rememberLauncherForActivityResult }
        dictationNote = null
        runCatching { recorder.start(); recording = true }
            .onFailure { dictationNote = "Micro indisponible : ${it.message ?: "échec"}." }
    }

    Surface(color = MaterialTheme.colorScheme.surface, modifier = Modifier.fillMaxWidth()) {
        Column(
            Modifier
                .padding(horizontal = 12.dp, vertical = 10.dp)
                .imePadding()
                .navigationBarsPadding(),
        ) {
            dictationNote?.let {
                Text(it, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.size(6.dp))
            }
            Row(verticalAlignment = Alignment.Bottom) {
                TextButton(
                    onClick = { imagePicker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                    enabled = !recording,
                    modifier = Modifier.heightIn(min = 56.dp).semantics { contentDescription = "Envoyer une photo" },
                ) { Text("Photo") }
                Spacer(Modifier.size(4.dp))
                TextButton(
                    onClick = {
                        if (recording) {
                            recording = false
                            val bytes = recorder.stop()
                            if (bytes == null) {
                                dictationNote = "Note vocale trop courte ou vide — rien envoyé."
                            } else {
                                dictationNote = null
                                onSendVoice(bytes)
                            }
                            return@TextButton
                        }
                        if (listening) return@TextButton // dictée en cours : pas de double usage du micro
                        recordPermission.launch(Manifest.permission.RECORD_AUDIO)
                    },
                    modifier = Modifier.heightIn(min = 56.dp).semantics {
                        contentDescription = if (recording) "Terminer et envoyer la note vocale" else "Enregistrer une note vocale"
                    },
                ) { Text(if (recording) "● Fin" else "Vocale") }
                Spacer(Modifier.size(4.dp))
                OutlinedTextField(
                    value = draft,
                    onValueChange = { draft = it },
                    modifier = Modifier.weight(1f).heightIn(min = 56.dp),
                    label = { Text(if (listening) "Dictée en cours…" else "Message à Mina") },
                    maxLines = 5,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                    keyboardActions = KeyboardActions(onSend = {
                        if (draft.isNotBlank()) { onSend(draft); draft = "" }
                    }),
                )
                Spacer(Modifier.size(8.dp))
                TextButton(
                    onClick = {
                        if (listening) {
                            dictation.stop()
                            listening = false
                            dictationNote = null
                            return@TextButton
                        }
                        if (!dictation.isAvailable()) {
                            dictationNote = "Aucune reconnaissance vocale sur cet appareil."
                            return@TextButton
                        }
                        dictationNote = null
                        micPermission.launch(Manifest.permission.RECORD_AUDIO)
                    },
                    modifier = Modifier.heightIn(min = 56.dp).semantics {
                        contentDescription = if (listening) "Arrêter la dictée" else "Dicter le message"
                    },
                ) { Text(if (listening) "Stop" else "Micro") }
                Spacer(Modifier.size(4.dp))
                Button(
                    onClick = { if (draft.isNotBlank()) { onSend(draft); draft = "" } },
                    enabled = draft.isNotBlank(),
                    modifier = Modifier.heightIn(min = 56.dp),
                ) { Text("Envoyer") }
            }
        }
    }
}

/** Traduit l'état de la dictée en effets sur le brouillon — sans jamais effacer ce qui est tapé. */
private fun handleDictation(
    state: DictationState,
    onDraft: (String) -> Unit,
    onListening: (Boolean) -> Unit,
    onNote: (String?) -> Unit,
) {
    when (state) {
        is DictationState.Listening -> onNote("Parlez, Mina écoute le micro de ce téléphone.")
        is DictationState.Partial -> onDraft(state.text)
        is DictationState.Final -> {
            onDraft(state.text)
            onListening(false)
            onNote(null)
        }
        is DictationState.Failed -> {
            onListening(false)
            onNote(state.reason)
        }
        DictationState.Idle -> onNote(null)
    }
}

@Composable
private fun PairingScreen(
    deviceId: String,
    defaultPort: Int,
    error: String?,
    onPair: (String, Int, String?) -> Unit,
) {
    var host by remember { mutableStateOf("") }
    var port by remember { mutableStateOf(defaultPort.toString()) }
    var pairingCode by remember { mutableStateOf("") }

    Surface(color = MaterialTheme.colorScheme.background, modifier = Modifier.fillMaxSize()) {
        Column(
            Modifier.padding(24.dp).imePadding(),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text("Appairer le PC", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
            Text(
                "Mina ne parle qu'à un PC appairé. Ouvrez l'appairage sur le PC (onglet Système), puis saisissez ici l'adresse et le code affichés.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            OutlinedTextField(
                value = host,
                onValueChange = { host = it },
                label = { Text("Adresse du PC (ex. 192.168.1.20)") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
            )
            OutlinedTextField(
                value = port,
                onValueChange = { port = it.filter(Char::isDigit).take(5) },
                label = { Text("Port") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
            )
            OutlinedTextField(
                value = pairingCode,
                onValueChange = { pairingCode = it.filter(Char::isDigit).take(6) },
                label = { Text("Code d'appairage à 6 chiffres") },
                supportingText = { Text("Affiché sur le PC, onglet Système. Valable 5 minutes, une seule fois.") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
            )
            error?.let {
                Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
            }
            Button(
                onClick = { onPair(host.trim(), port.toIntOrNull() ?: defaultPort, pairingCode.trim().ifBlank { null }) },
                enabled = host.isNotBlank() && pairingCode.length == 6,
                modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
            ) { Text("Appairer") }
            Text(
                "Identifiant de cet appareil : $deviceId",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
internal fun LoadingDot() {
    CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
}
