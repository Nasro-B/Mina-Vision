package fr.mina.gateway.feature.chat

import org.junit.Assert.assertEquals
import org.junit.Test

class NotificationPermissionCoordinatorTest {
    @Test
    fun `ne propose pas les notifications avant appairage`() {
        assertEquals(
            ChatNotificationPermissionStatus.PAIRING_REQUIRED,
            NotificationPermissionCoordinator.status(apiLevel = 35, paired = false, granted = false),
        )
    }

    @Test
    fun `propose la permission seulement apres appairage sur Android 13 plus`() {
        assertEquals(
            ChatNotificationPermissionStatus.REQUESTABLE,
            NotificationPermissionCoordinator.status(apiLevel = 35, paired = true, granted = false),
        )
    }

    @Test
    fun `ne demande pas de permission runtime avant Android 13`() {
        assertEquals(
            ChatNotificationPermissionStatus.NOT_REQUIRED,
            NotificationPermissionCoordinator.status(apiLevel = 32, paired = true, granted = false),
        )
    }

    @Test
    fun `ne presente pas de faux prompt runtime Android 12 avant appairage`() {
        assertEquals(
            ChatNotificationPermissionStatus.NOT_REQUIRED,
            NotificationPermissionCoordinator.status(apiLevel = 32, paired = false, granted = false),
        )
    }

    @Test
    fun `rapporte une permission deja accordee`() {
        assertEquals(
            ChatNotificationPermissionStatus.GRANTED,
            NotificationPermissionCoordinator.status(apiLevel = 35, paired = true, granted = true),
        )
    }

    @Test
    fun `affiche le refus sans relancer automatiquement le prompt`() {
        assertEquals(
            ChatNotificationPermissionStatus.DENIED,
            NotificationPermissionCoordinator.status(
                apiLevel = 35,
                paired = true,
                granted = false,
                promptAttempted = true,
                shouldShowRationale = true,
            ),
        )
    }

    @Test
    fun `ne qualifie pas une fermeture du dialogue de refus permanent`() {
        assertEquals(
            ChatNotificationPermissionStatus.DENIED,
            NotificationPermissionCoordinator.status(
                apiLevel = 35,
                paired = true,
                granted = false,
                promptAttempted = true,
                refusalObserved = false,
                shouldShowRationale = false,
            ),
        )
    }

    @Test
    fun `redirige vers les reglages apres refus observe puis absence de rationale`() {
        assertEquals(
            ChatNotificationPermissionStatus.DENIED_PERMANENTLY,
            NotificationPermissionCoordinator.status(
                apiLevel = 35,
                paired = true,
                granted = false,
                promptAttempted = true,
                refusalObserved = true,
                shouldShowRationale = false,
            ),
        )
    }
}
