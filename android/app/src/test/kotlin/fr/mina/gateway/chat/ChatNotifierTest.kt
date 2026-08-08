package fr.mina.gateway.chat

import android.Manifest
import android.app.Application
import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * Catches the regression where a decrypted reply is copied into Android's notification history.
 * The real notification is built and inspected; the Android manager itself is not mocked.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class ChatNotifierTest {
    private lateinit var context: Context

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        shadowOf(context as Application).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        ChatNotifier.ensureChannel(context)
    }

    @Test
    fun `une reponse ne met jamais son texte dechiffre dans la notification privee par defaut`() {
        val secret = "le code du portail est 4821"

        ChatNotifier.notifyReply(context, secret)

        val manager = context.getSystemService(NotificationManager::class.java)
        val notification = shadowOf(manager).getNotification(4_201)
            ?: error("notification_absente")
        assertEquals("Mina a répondu", notification.extras.getCharSequence(Notification.EXTRA_TEXT))
        assertFalse(notification.extras.toString().contains(secret))
        assertEquals(Notification.VISIBILITY_PRIVATE, notification.visibility)
    }
}
