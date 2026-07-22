package fr.mina.gateway.messaging

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import fr.mina.gateway.messaging.storage.AndroidKeystoreFieldCipher
import fr.mina.gateway.messaging.storage.EncryptedMessageRepository
import fr.mina.gateway.messaging.storage.MessagingDatabase

class SmsBroadcastReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        val pending = goAsync()
        MessagingExecutors.io.execute {
            try {
                val parts = Telephony.Sms.Intents.getMessagesFromIntent(intent).mapNotNull { message ->
                    val sender = message.displayOriginatingAddress ?: message.originatingAddress ?: return@mapNotNull null
                    SmsPart(sender, message.messageBody.orEmpty(), message.timestampMillis)
                }
                val inbound = SmsMessageAssembler.assemble(parts) ?: return@execute
                val sender = PhoneNumberNormalizer.toE164(inbound.sender) ?: inbound.sender
                val database = MessagingDatabase.open(context)
                EncryptedMessageRepository(database.messageDao(), AndroidKeystoreFieldCipher())
                    .storeInboundSms(sender, inbound.body, inbound.sentAtMs)
            } finally {
                pending.finish()
            }
        }
    }
}
