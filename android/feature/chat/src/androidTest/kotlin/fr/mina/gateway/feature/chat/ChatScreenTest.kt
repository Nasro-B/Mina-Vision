package fr.mina.gateway.feature.chat

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.center
import androidx.compose.ui.test.down
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.up
import androidx.test.ext.junit.runners.AndroidJUnit4
import fr.mina.gateway.chat.ChatMessage
import fr.mina.gateway.chat.LinkState
import fr.mina.gateway.feature.voice.VoiceCaptureMode
import fr.mina.gateway.feature.voice.VoiceNoteUiState
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ChatScreenTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun composerKeepsDraftUntilTheViewModelReportsPersistence() {
        var state by mutableStateOf(
            ChatUiState(
                paired = true,
                link = LinkState.OFFLINE,
                pendingCount = 0,
                linkError = null,
                sendError = null,
                draft = "brouillon a conserver",
                sending = false,
            ),
        )
        var sends = 0

        compose.setContent {
            MinaChatTheme {
                ChatScreen(
                    messages = emptyList(),
                    state = state,
                    onDraftChange = { state = state.copy(draft = it) },
                    onSend = { sends += 1 },
                    onSendImage = {},
                    voice = VoiceNoteUiState(),
                    onBeginVoiceNote = {},
                    onStopVoiceNote = {},
                    onCancelVoice = {},
                    onBeginPushToTalk = {},
                    onEndPushToTalk = {},
                    onRetryVoice = {},
                    onVoicePermissionDenied = {},
                    onVoiceHostStopped = {},
                    hasRecordPermission = { true },
                    onRetry = {},
                    onDismissError = {},
                    onUnpair = {},
                )
            }
        }

        compose.onNodeWithText("Envoyer").performClick()
        compose.runOnIdle { assertEquals(1, sends) }
        compose.onNodeWithText("brouillon a conserver").assertIsDisplayed()
    }

    @Test
    fun pushToTalkBeginsOnPressAndStopsOnRelease() {
        var voice by mutableStateOf(VoiceNoteUiState())
        var starts = 0
        var stops = 0

        compose.setContent {
            MinaChatTheme {
                ChatScreen(
                    messages = emptyList(),
                    state = ChatUiState(true, LinkState.ONLINE, 0, null, null, "", false),
                    onDraftChange = {},
                    onSend = {},
                    onSendImage = {},
                    voice = voice,
                    onBeginVoiceNote = {},
                    onStopVoiceNote = {},
                    onCancelVoice = {},
                    onBeginPushToTalk = {
                        starts += 1
                        voice = voice.copy(mode = VoiceCaptureMode.PUSH_TO_TALK)
                    },
                    onEndPushToTalk = {
                        stops += 1
                        voice = voice.copy(mode = null)
                    },
                    onRetryVoice = {},
                    onVoicePermissionDenied = {},
                    onVoiceHostStopped = {},
                    hasRecordPermission = { true },
                    onRetry = {},
                    onDismissError = {},
                    onUnpair = {},
                )
            }
        }

        compose.onNodeWithContentDescription("Maintenir pour parler").performTouchInput {
            down(center)
            up()
        }

        compose.runOnIdle {
            assertEquals(1, starts)
            assertEquals(1, stops)
        }
    }

    @Test
    fun olderMessagesActionIsExplicitAndInvokesTheViewModel() {
        var loads = 0
        val message = ChatMessage(
            eventId = "event-51",
            threadId = MAIN_THREAD_ID,
            text = "message precedent",
            fromAssistant = false,
            createdAtMs = 51,
            deliveryState = "completed",
        )

        compose.setContent {
            MinaChatTheme {
                ChatScreen(
                    messages = listOf(message),
                    state = ChatUiState(true, LinkState.ONLINE, 0, null, null, "", false),
                    history = ChatHistoryWindowState(messages = listOf(message), hasOlder = true),
                    onLoadOlder = { loads += 1 },
                    onDraftChange = {},
                    onSend = {},
                    onSendImage = {},
                    voice = VoiceNoteUiState(),
                    onBeginVoiceNote = {},
                    onStopVoiceNote = {},
                    onCancelVoice = {},
                    onBeginPushToTalk = {},
                    onEndPushToTalk = {},
                    onRetryVoice = {},
                    onVoicePermissionDenied = {},
                    onVoiceHostStopped = {},
                    hasRecordPermission = { true },
                    onRetry = {},
                    onDismissError = {},
                    onUnpair = {},
                )
            }
        }

        compose.onNodeWithContentDescription("Charger les messages précédents").assertIsDisplayed().performClick()
        compose.runOnIdle { assertEquals(1, loads) }
    }
}
