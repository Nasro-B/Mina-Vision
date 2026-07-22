package fr.mina.gateway.messaging

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class GatewayKeepaliveReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_KEEPALIVE) return
        context.startForegroundService(Intent(context, MinaGatewayService::class.java))
    }

    companion object {
        const val ACTION_KEEPALIVE = "fr.mina.gateway.action.KEEPALIVE"
    }
}
