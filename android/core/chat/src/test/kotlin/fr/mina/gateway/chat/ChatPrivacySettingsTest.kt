package fr.mina.gateway.chat

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatPrivacySettingsTest {
    @Test
    fun `les reglages de confidentialite demarrent en mode prive`() {
        val settings = ChatPrivacySettings()

        assertFalse(settings.showLockScreenPreview)
        assertTrue(settings.secureChatWindow)
        assertFalse(settings.huaweiForegroundConsent)
        assertFalse(settings.notificationPromptAttempted)
        assertFalse(settings.notificationRefusalObserved)
    }
}
