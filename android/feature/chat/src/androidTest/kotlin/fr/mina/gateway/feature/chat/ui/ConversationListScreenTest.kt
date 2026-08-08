package fr.mina.gateway.feature.chat.ui

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import fr.mina.gateway.feature.chat.MinaChatTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ConversationListScreenTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun conversationAndSettingsExposeOnlyTheExpectedNavigationActions() {
        var openedThread: String? = null
        var gatewayOpened = false
        var settingsOpened = false

        compose.setContent {
            MinaChatTheme {
                ConversationListScreen(
                    onOpenConversation = { openedThread = it },
                    onOpenGateway = { gatewayOpened = true },
                    onOpenSettings = { settingsOpened = true },
                )
            }
        }

        compose.onNodeWithContentDescription("Ouvrir la conversation avec Mina").performClick()
        compose.onNodeWithText("Configurer la passerelle SMS & Telegram").performClick()
        compose.onNodeWithText("Réglages").performClick()
        compose.runOnIdle {
            assertEquals("main", openedThread)
            assertTrue(gatewayOpened)
            assertTrue(settingsOpened)
        }
    }

    @Test
    fun deviceScreenStatesThatManagementRemainsOnThePairedPc() {
        var wentBack = false

        compose.setContent {
            MinaChatTheme { DeviceScreen(onBack = { wentBack = true }) }
        }

        compose.onNodeWithText("gérés depuis le PC", substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("Revenir aux conversations").performClick()
        compose.runOnIdle { assertTrue(wentBack) }
    }

    @Test
    fun settingsCanOpenTheReadOnlyDeviceScreen() {
        var devicesOpened = false

        compose.setContent {
            MinaChatTheme {
                SettingsScreen(
                    onOpenGateway = {},
                    onOpenDevices = { devicesOpened = true },
                    onBack = {},
                )
            }
        }

        compose.onNodeWithContentDescription("Afficher les appareils associés en lecture seule").performClick()
        compose.runOnIdle { assertTrue(devicesOpened) }
    }
}
