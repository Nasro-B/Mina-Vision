package fr.mina.gateway.chat

import android.app.Activity
import android.view.WindowManager
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class ChatWindowPrivacyTest {
    @Test
    fun `la fenetre de chat interdit les captures par defaut`() {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()

        ChatWindowPrivacy.apply(activity.window)

        assertTrue(activity.window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0)
    }
}
