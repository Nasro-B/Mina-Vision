package fr.mina.gateway.chat

import android.view.Window
import android.view.WindowManager

/** Le chat est privé par défaut : Android refuse les captures tant que cet écran est ouvert. */
internal object ChatWindowPrivacy {
    fun apply(window: Window) {
        window.setFlags(
            WindowManager.LayoutParams.FLAG_SECURE,
            WindowManager.LayoutParams.FLAG_SECURE,
        )
    }
}
