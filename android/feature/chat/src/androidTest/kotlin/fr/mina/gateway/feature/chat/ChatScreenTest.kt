package fr.mina.gateway.feature.chat

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import fr.mina.gateway.chat.LinkState
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
                    onSendVoice = {},
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
}
