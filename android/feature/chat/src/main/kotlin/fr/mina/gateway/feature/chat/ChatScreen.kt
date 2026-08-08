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
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.platform.LocalContext
import fr.mina.gateway.feature.voice.DictationState
import fr.mina.gateway.feature.voice.PcmVoicePlayer
import fr.mina.gateway.feature.voice.VoiceCaptureMode
import fr.mina.gateway.feature.voice.VoiceDictation
import fr.mina.gateway.feature.voice.VoiceNoteUiState
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.viewmodel.compose.viewModel
import fr.mina.gateway.chat.ChatMessage
import fr.mina.gateway.chat.DeliveryState
import fr.mina.gateway.chat.LinkState
import fr.mina.gateway.protocol.VoicePcmFormat
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun ChatRoute(viewModel: ChatViewModel = viewModel()) {
    val messages by viewModel.messages.collectAsStateWithLifecycle()
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val voice by viewModel.voiceState.collectAsStateWithLifecycle()
    val context = LocalContext.current
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
                onDraftChange = viewModel::updateDraft,
                onSend = viewModel::sendDraft,
                onSendImage = viewModel::sendImage,
                voice = voice,
                onBeginVoiceNote = viewModel::beginVoiceNote,
                onStopVoiceNote = viewModel::stopVoiceNote,
                onCancelVoice = viewModel::cancelVoiceNote,
                onBeginPushToTalk = viewModel::beginPushToTalk,
                onEndPushToTalk = viewModel::endPushToTalk,
                onRetryVoice = viewModel::retryPendingVoice,
                onVoicePermissionDenied = viewModel::voicePermissionDenied,
                onVoiceHostStopped = viewModel::onVoiceHostStopped,
                hasRecordPermission = {
                    ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
                        PackageManager.PERMISSION_GRANTED
                },
                loadMedia = viewModel::loadMedia,
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
    onDraftChange: (String) -> Unit,
    onSend: () -> Unit,
    onSendImage: (android.net.Uri) -> Unit,
    voice: VoiceNoteUiState,
    onBeginVoiceNote: () -> Unit,
    onStopVoiceNote: () -> Unit,
    onCancelVoice: () -> Unit,
    onBeginPushToTalk: () -> Unit,
    onEndPushToTalk: () -> Unit,
    onRetryVoice: () -> Unit,
    onVoicePermissionDenied: () -> Unit,
    onVoiceHostStopped: () -> Unit,
    hasRecordPermission: () -> Boolean,
    loadMedia: suspend (String) -> Pair<ByteArray, String>? = { null },
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
                    items(messages, key = { it.eventId }) { message -> MessageBubble(message, loadMedia) }
                }
            }

            state.sendError?.let { error ->
                ErrorStrip(text = error, onDismiss = onDismissError)
            }

            Composer(
                draft = state.draft,
                sending = state.sending,
                onDraftChange = onDraftChange,
                onSend = onSend,
                onSendImage = onSendImage,
                voice = voice,
                onBeginVoiceNote = onBeginVoiceNote,
                onStopVoiceNote = onStopVoiceNote,
                onCancelVoice = onCancelVoice,
                onBeginPushToTalk = onBeginPushToTalk,
                onEndPushToTalk = onEndPushToTalk,
                onRetryVoice = onRetryVoice,
                onVoicePermissionDenied = onVoicePermissionDenied,
                onVoiceHostStopped = onVoiceHostStopped,
                hasRecordPermission = hasRecordPermission,
            )
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
private fun MessageBubble(message: ChatMessage, loadMedia: suspend (String) -> Pair<ByteArray, String>? = { null }) {
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
                when (message.kind) {
                    // W6 : médias reçus — réassemblés en mémoire depuis les lignes chiffrées.
                    "image" -> MediaImage(message, loadMedia)
                    "voice" -> MediaVoice(message, loadMedia)
                    "call" -> CallProposal(message)
                    else -> Text(message.text, style = MaterialTheme.typography.bodyLarge)
                }
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

/**
 * W6 — image reçue : les octets sont réassemblés EN MÉMOIRE depuis les lignes chiffrées du fil
 * (jamais un fichier en clair au repos). Incomplète/altérée => état honnête, pas d'image partielle.
 */
@Composable
private fun MediaImage(message: ChatMessage, loadMedia: suspend (String) -> Pair<ByteArray, String>?) {
    var bitmap by remember(message.mediaId) { mutableStateOf<android.graphics.Bitmap?>(null) }
    var failed by remember(message.mediaId) { mutableStateOf(false) }
    LaunchedEffect(message.mediaId) {
        val id = message.mediaId ?: run { failed = true; return@LaunchedEffect }
        val media = loadMedia(id)
        if (media == null) { failed = true; return@LaunchedEffect }
        bitmap = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Default) {
            android.graphics.BitmapFactory.decodeByteArray(media.first, 0, media.first.size)
        }
        if (bitmap == null) failed = true
    }
    when {
        bitmap != null -> androidx.compose.foundation.Image(
            bitmap = bitmap!!.asImageBitmap(),
            contentDescription = "Image reçue",
            modifier = Modifier.fillMaxWidth().heightIn(max = 320.dp),
        )
        failed -> Text("📷 Image incomplète ou illisible", style = MaterialTheme.typography.bodyMedium)
        else -> Text("📷 Image…", style = MaterialTheme.typography.bodyMedium)
    }
}

/** W6 — la note PCM canonique reste en mémoire et est lue directement par AudioTrack. */
@Composable
private fun MediaVoice(message: ChatMessage, loadMedia: suspend (String) -> Pair<ByteArray, String>?) {
    var playing by remember(message.mediaId) { mutableStateOf(false) }
    var note by remember(message.mediaId) { mutableStateOf<String?>(null) }
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    Row(verticalAlignment = Alignment.CenterVertically) {
        TextButton(onClick = {
            if (playing) return@TextButton
            val id = message.mediaId ?: run { note = "Note vocale illisible."; return@TextButton }
            scope.launch {
                val media = loadMedia(id)
                if (media == null) { note = "Note vocale incomplète ou illisible."; return@launch }
                val bytes = media.first
                if (!VoicePcmFormat.isCanonicalMime(media.second)) {
                    bytes.fill(0)
                    note = "Cette note utilise un ancien format audio indisponible sur cette version."
                    return@launch
                }
                try {
                    playing = true
                    note = null
                    withContext(Dispatchers.IO) { PcmVoicePlayer.create().play(bytes) }
                } catch (error: CancellationException) {
                    throw error
                } catch (error: Exception) {
                    note = "Lecture impossible : ${error.message ?: "échec"}."
                } finally {
                    bytes.fill(0)
                    playing = false
                }
            }
        }) { Text(if (playing) "▶ Lecture…" else "▶ Écouter la note vocale") }
    }
    note?.let { Text(it, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
}

/**
 * Appels (Vague 2, D1/D4) : le PC PROPOSE un appel — le bouton ouvre le COMPOSEUR pré-rempli
 * (ACTION_DIAL, zéro permission). C'est TOI qui appuies sur « appeler », jamais l'application.
 */
@Composable
private fun CallProposal(message: ChatMessage) {
    val context = LocalContext.current
    Column {
        Text(message.text, style = MaterialTheme.typography.bodyLarge)
        val number = message.mediaId
        if (number != null) {
            TextButton(onClick = {
                runCatching {
                    context.startActivity(
                        android.content.Intent(android.content.Intent.ACTION_DIAL).apply {
                            data = android.net.Uri.parse("tel:" + android.net.Uri.encode(number))
                        },
                    )
                }
            }) { Text("📞 Ouvrir le composeur") }
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

private enum class MicrophoneAction {
    DICTATION,
    NOTE,
    PUSH_TO_TALK,
}

@Composable
private fun Composer(
    draft: String,
    sending: Boolean,
    onDraftChange: (String) -> Unit,
    onSend: () -> Unit,
    onSendImage: (android.net.Uri) -> Unit,
    voice: VoiceNoteUiState,
    onBeginVoiceNote: () -> Unit,
    onStopVoiceNote: () -> Unit,
    onCancelVoice: () -> Unit,
    onBeginPushToTalk: () -> Unit,
    onEndPushToTalk: () -> Unit,
    onRetryVoice: () -> Unit,
    onVoicePermissionDenied: () -> Unit,
    onVoiceHostStopped: () -> Unit,
    hasRecordPermission: () -> Boolean,
) {
    var dictationNote by remember { mutableStateOf<String?>(null) }
    var listening by remember { mutableStateOf(false) }
    var requestedMicrophoneAction by remember { mutableStateOf<MicrophoneAction?>(null) }
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val dictation = remember { VoiceDictation(context) }
    val microphonePermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val action = requestedMicrophoneAction
        requestedMicrophoneAction = null
        when (action) {
            MicrophoneAction.DICTATION -> {
                if (!granted) {
                    dictationNote = "Permission micro refusée : la dictée reste indisponible."
                } else {
                    listening = true
                    dictation.start { state ->
                        handleDictation(state, onDraftChange, { listening = it }, { dictationNote = it })
                    }
                }
            }
            MicrophoneAction.NOTE -> if (!granted) onVoicePermissionDenied() else onBeginVoiceNote()
            MicrophoneAction.PUSH_TO_TALK -> {
                if (!granted) onVoicePermissionDenied()
                else dictationNote = "Maintenez le bouton PTT pour enregistrer une note vocale."
            }
            null -> Unit
        }
    }
    val requestMicrophone = { action: MicrophoneAction ->
        if (hasRecordPermission()) {
            when (action) {
                MicrophoneAction.DICTATION -> {
                    listening = true
                    dictation.start { state ->
                        handleDictation(state, onDraftChange, { listening = it }, { dictationNote = it })
                    }
                }
                MicrophoneAction.NOTE -> onBeginVoiceNote()
                MicrophoneAction.PUSH_TO_TALK -> onBeginPushToTalk()
            }
        } else {
            requestedMicrophoneAction = action
            microphonePermission.launch(Manifest.permission.RECORD_AUDIO)
        }
    }
    val currentVoice by rememberUpdatedState(voice)
    val currentListening by rememberUpdatedState(listening)
    val currentHasRecordPermission by rememberUpdatedState(hasRecordPermission)
    val currentRequestMicrophone by rememberUpdatedState(requestMicrophone)
    val currentBeginPushToTalk by rememberUpdatedState(onBeginPushToTalk)
    val currentEndPushToTalk by rememberUpdatedState(onEndPushToTalk)
    val currentCancelVoice by rememberUpdatedState(onCancelVoice)

    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP) {
                dictation.stop()
                listening = false
                onVoiceHostStopped()
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            dictation.stop()
            onVoiceHostStopped()
        }
    }

    val imagePicker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) onSendImage(uri)
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
            voice.note?.let { note ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        note,
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.weight(1f),
                    )
                    if (voice.canRetry) TextButton(onClick = onRetryVoice) { Text("Réessayer") }
                }
                Spacer(Modifier.size(6.dp))
            }
            Row(verticalAlignment = Alignment.Bottom) {
                TextButton(
                    onClick = { imagePicker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                    enabled = !voice.isRecording,
                    modifier = Modifier.heightIn(min = 56.dp).semantics { contentDescription = "Envoyer une photo" },
                ) { Text("Photo") }
                Spacer(Modifier.size(4.dp))
                TextButton(
                    onClick = {
                        when (voice.mode) {
                            VoiceCaptureMode.NOTE -> onStopVoiceNote()
                            VoiceCaptureMode.PUSH_TO_TALK -> onCancelVoice()
                            null -> if (!listening) requestMicrophone(MicrophoneAction.NOTE)
                        }
                    },
                    modifier = Modifier.heightIn(min = 56.dp).semantics {
                        contentDescription = if (voice.mode == VoiceCaptureMode.NOTE) {
                            "Terminer et envoyer la note vocale"
                        } else {
                            "Enregistrer une note vocale"
                        }
                    },
                ) { Text(if (voice.mode == VoiceCaptureMode.NOTE) "● Arrêter" else "Vocale") }
                if (voice.mode == VoiceCaptureMode.NOTE) {
                    TextButton(
                        onClick = onCancelVoice,
                        modifier = Modifier.heightIn(min = 56.dp).semantics { contentDescription = "Annuler la note vocale" },
                    ) { Text("Annuler") }
                }
                Spacer(Modifier.size(4.dp))
                Surface(
                    color = if (voice.isRecording || listening) {
                        MaterialTheme.colorScheme.surfaceVariant
                    } else {
                        MaterialTheme.colorScheme.secondaryContainer
                    },
                    shape = RoundedCornerShape(24.dp),
                    modifier = Modifier
                        .heightIn(min = 56.dp)
                        .semantics { contentDescription = "Maintenir pour parler" }
                        .pointerInput(Unit) {
                            awaitEachGesture {
                                awaitFirstDown(requireUnconsumed = false)
                                if (!currentVoice.isRecording && !currentListening) {
                                    if (currentHasRecordPermission()) {
                                        currentBeginPushToTalk()
                                        if (waitForUpOrCancellation() == null) {
                                            currentCancelVoice()
                                        } else {
                                            currentEndPushToTalk()
                                        }
                                    } else {
                                        currentRequestMicrophone(MicrophoneAction.PUSH_TO_TALK)
                                    }
                                }
                            }
                        },
                ) {
                    Text(
                        "PTT",
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 16.dp),
                        color = MaterialTheme.colorScheme.onSecondaryContainer,
                    )
                }
                Spacer(Modifier.size(4.dp))
                OutlinedTextField(
                    value = draft,
                    onValueChange = onDraftChange,
                    modifier = Modifier.weight(1f).heightIn(min = 56.dp),
                    label = { Text(if (listening) "Dictée en cours…" else "Message à Mina") },
                    maxLines = 5,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                    keyboardActions = KeyboardActions(onSend = {
                        if (draft.isNotBlank() && !sending) onSend()
                    }),
                )
                Spacer(Modifier.size(8.dp))
                TextButton(
                    onClick = {
                        if (voice.isRecording) return@TextButton
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
                        requestMicrophone(MicrophoneAction.DICTATION)
                    },
                    enabled = !voice.isRecording,
                    modifier = Modifier.heightIn(min = 56.dp).semantics {
                        contentDescription = if (listening) "Arrêter la dictée" else "Dicter le message"
                    },
                ) { Text(if (listening) "Stop" else "Micro") }
                Spacer(Modifier.size(4.dp))
                Button(
                    onClick = onSend,
                    enabled = draft.isNotBlank() && !sending,
                    modifier = Modifier.heightIn(min = 56.dp),
                ) { Text(if (sending) "Envoi…" else "Envoyer") }
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
