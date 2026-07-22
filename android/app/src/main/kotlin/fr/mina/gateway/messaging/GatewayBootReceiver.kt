package fr.mina.gateway.messaging

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class GatewayBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action !in setOf(Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED)) return
        context.startForegroundService(Intent(context, MinaGatewayService::class.java))
    }
}
