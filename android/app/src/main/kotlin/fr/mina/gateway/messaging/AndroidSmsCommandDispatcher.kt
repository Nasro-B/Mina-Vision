package fr.mina.gateway.messaging

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.telephony.SmsManager
import fr.mina.gateway.messaging.storage.EncryptedMessageRepository

class AndroidSmsCommandDispatcher(
    private val context: Context,
    private val messages: EncryptedMessageRepository,
) : SmsCommandDispatcher {
    @Suppress("DEPRECATION")
    override fun dispatch(command: SmsCommand): SmsCommandReceipt {
        if (context.checkSelfPermission(Manifest.permission.SEND_SMS) != PackageManager.PERMISSION_GRANTED) {
            return SmsCommandReceipt(command.id, "failed", "sms_permission_missing")
        }
        val stored = messages.storeOutboundSms(command.id, command.recipientE164, command.text)
        if (!stored.inserted) return SmsCommandReceipt(command.id, "duplicate")
        return try {
            val manager = SmsManager.getDefault()
            val parts = manager.divideMessage(command.text)
            if (parts.size == 1) {
                manager.sendTextMessage(command.recipientE164, null, command.text, null, null)
            } else {
                manager.sendMultipartTextMessage(command.recipientE164, null, parts, null, null)
            }
            SmsCommandReceipt(command.id, "queued")
        } catch (_: Exception) {
            messages.updateState(stored.dedupeIndex, "failed")
            SmsCommandReceipt(command.id, "failed", "android_sms_rejected")
        }
    }
}
