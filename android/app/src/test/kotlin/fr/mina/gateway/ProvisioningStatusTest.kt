package fr.mina.gateway

import org.junit.Assert.assertEquals
import org.junit.Test

class ProvisioningStatusTest {
    @Test
    fun reportsNonConfigureWhenNothingSavedYet() {
        val text = provisioningStatusText(
            ProvisioningState(smsPermissionGranted = false, hasOwnerIdentity = false, hasTelegramToken = false),
        )
        assertEquals("SMS : permission requise\nTelegram : non configuré", text)
    }

    @Test
    fun reportsConfiguredAndRunningWhenIdentityAndTokenAreBothSaved() {
        val text = provisioningStatusText(
            ProvisioningState(smsPermissionGranted = true, hasOwnerIdentity = true, hasTelegramToken = true),
        )
        assertEquals("SMS : autorisé\nTelegram : configuré, service démarré", text)
    }

    @Test
    fun reportsPartialStateWhenIdentitySavedButTokenMissing() {
        val text = provisioningStatusText(
            ProvisioningState(smsPermissionGranted = true, hasOwnerIdentity = true, hasTelegramToken = false),
        )
        assertEquals("SMS : autorisé\nTelegram : identité enregistrée, token manquant", text)
    }

    @Test
    fun treatsTokenWithoutIdentityAsNotConfigured() {
        val text = provisioningStatusText(
            ProvisioningState(smsPermissionGranted = true, hasOwnerIdentity = false, hasTelegramToken = true),
        )
        assertEquals("SMS : autorisé\nTelegram : non configuré", text)
    }

    @Test
    fun keepsAnExistingEncryptedTokenWhenOnlyOwnerIdsAreUpdated() {
        assertEquals(false, shouldReplaceTelegramToken(providedTokenLength = 0, hasStoredToken = true))
    }

    @Test(expected = IllegalArgumentException::class)
    fun refusesAnOwnerUpdateWhenNoTelegramTokenExistsAnywhere() {
        shouldReplaceTelegramToken(providedTokenLength = 0, hasStoredToken = false)
    }
}
