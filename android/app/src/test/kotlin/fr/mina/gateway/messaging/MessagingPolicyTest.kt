package fr.mina.gateway.messaging

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class MessagingPolicyTest {
    private val owner = OwnerIdentity("+33600000000", setOf(111L, 222L))

    @Test
    fun smsOnlyDraftsAndRequiresConfirmationUnlessExplicitAutoSendIsEnabled() {
        val sent = mutableListOf<SmsDraft>()
        val gateway = SmsGateway(owner) { sent += it; "provider-${sent.size}" }
        val draft = gateway.draftReply("sms-1", "+33600000000", "Bien reçu")
        assertEquals(SmsSendState.AWAITING_CONFIRMATION, gateway.requestSend(draft.draftId).state)
        assertTrue(sent.isEmpty())
        assertEquals(SmsSendState.ACCEPTED_BY_PROVIDER, gateway.confirmSend(draft.draftId).state)
        gateway.setAutoSend(true, setOf("+33600000000"), locallyConfirmed = true)
        val auto = gateway.draftReply("sms-2", "+33600000000", "Automatique")
        assertEquals(SmsSendState.ACCEPTED_BY_PROVIDER, gateway.requestSend(auto.draftId).state)
        assertFalse(gateway.allowsCapability("computer.click"))
        assertFalse(gateway.allowsCapability("mail.send"))
    }

    @Test
    fun telegramBindsNumericOwnerAndOnlyEnablesLocallyScopedMailOrLowRiskHome() {
        val gateway = TelegramGateway(owner)
        assertTrue(gateway.allows(111L, "conversation.reply"))
        assertTrue(gateway.allows(222L, "memory.read"))
        assertFalse(gateway.allows(111L, "mail.read"))
        gateway.enableCapabilities(setOf("mail.read", "home.read", "home.low_risk"), locallyConfirmed = true)
        assertTrue(gateway.allows(111L, "mail.read"))
        assertTrue(gateway.allows(222L, "home.low_risk"))
        assertFalse(gateway.allows(111L, "computer.click"))
        assertFalse(gateway.allows(999L, "conversation.reply"))
        assertThrows(IllegalArgumentException::class.java) {
            gateway.enableCapabilities(setOf("sandbox.execute"), locallyConfirmed = true)
        }
    }
}
