package fr.mina.gateway.messaging

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.IBinder
import fr.mina.gateway.MainActivity
import fr.mina.gateway.messaging.storage.AndroidKeystoreFieldCipher
import fr.mina.gateway.messaging.storage.EncryptedMessageRepository
import fr.mina.gateway.messaging.storage.EncryptedOwnerIdentityStore
import fr.mina.gateway.messaging.storage.EncryptedTelegramOffsetStore
import fr.mina.gateway.messaging.storage.MessagingDatabase
import fr.mina.gateway.messaging.storage.RoomMessagingSecretStore
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

class MinaGatewayService : Service() {
    private val running = AtomicBoolean(false)
    private val pollExecutor = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "mina-telegram-poller").apply { isDaemon = true }
    }
    private val commandExecutor = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "mina-adb-command-poller").apply { isDaemon = true }
    }
    private var token: CharArray? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }
        startForeground(NOTIFICATION_ID, notification("SMS actif · Telegram en démarrage"))
        if (running.compareAndSet(false, true)) {
            pollExecutor.execute {
                try {
                    runPollLoop()
                } catch (_: Exception) {
                    updateNotification("SMS actif · stockage sécurisé indisponible")
                }
            }
            commandExecutor.execute(::runCommandLoop)
        }
        return START_STICKY
    }

    override fun onDestroy() {
        running.set(false)
        pollExecutor.shutdownNow()
        commandExecutor.shutdownNow()
        token?.fill('\u0000')
        token = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun runPollLoop() {
        val database = MessagingDatabase.open(this)
        val cipher = AndroidKeystoreFieldCipher()
        val secrets = RoomMessagingSecretStore(database.secretDao(), cipher)
        val owner = EncryptedOwnerIdentityStore(secrets).load()
        val loadedToken = secrets.get("telegram_bot_token")
        if (owner == null || loadedToken == null) {
            updateNotification("SMS actif · Telegram non configuré")
            return
        }
        token = loadedToken
        val messages = EncryptedMessageRepository(database.messageDao(), cipher)
        val poller = TelegramPoller(
            owner,
            BotApiUpdateSource(TelegramApiClient()),
            TelegramUpdateSink { messages.storeInboundTelegram(it) },
            EncryptedTelegramOffsetStore(secrets),
            TelegramUpdateSink { update ->
                val temporary = filesDir.resolve("telegram-pairing-candidate.json.tmp")
                val target = filesDir.resolve("telegram-pairing-candidate.json")
                temporary.writeText(JSONObject().apply {
                    put("version", 1)
                    put("telegramUserId", update.senderUserId.toString())
                    put("capturedAtMs", System.currentTimeMillis())
                }.toString())
                if (target.exists()) check(target.delete()) { "telegram_pairing_candidate_replace_failed" }
                check(temporary.renameTo(target)) { "telegram_pairing_candidate_commit_failed" }
            },
        )
        updateNotification("SMS actif · Telegram connecté")
        try {
            while (running.get() && !Thread.currentThread().isInterrupted) {
                try {
                    poller.pollOnce(loadedToken)
                } catch (_: Exception) {
                    updateNotification("SMS actif · Telegram en reconnexion")
                    Thread.sleep(RETRY_DELAY_MS)
                }
            }
        } finally {
            loadedToken.fill('\u0000')
            token = null
        }
    }

    private fun runCommandLoop() {
        val database = MessagingDatabase.open(this)
        val cipher = AndroidKeystoreFieldCipher()
        val repository = EncryptedMessageRepository(database.messageDao(), cipher)
        val secrets = RoomMessagingSecretStore(database.secretDao(), cipher)
        val owner = EncryptedOwnerIdentityStore(secrets).load()
        val processor = SmsCommandFileProcessor(filesDir, AndroidSmsCommandDispatcher(this, repository))
        val messageProcessor = MessagePullFileProcessor(filesDir, object : MessageQueueSource {
            override fun pending(limit: Int): List<PendingGatewayMessage> = repository.pending(limit)
            override fun acknowledge(messageIds: List<String>): Int = repository.acknowledge(messageIds)
        }, TelegramReplySender { _, chatId, text ->
            require(owner?.ownsTelegram(chatId) == true) { "telegram_chat_not_owned" }
            val commandToken = requireNotNull(secrets.get("telegram_bot_token")) { "telegram_token_missing" }
            try {
                TelegramApiClient().sendMessage(commandToken, chatId, text)
            } finally {
                commandToken.fill('\u0000')
            }
        })
        while (running.get() && !Thread.currentThread().isInterrupted) {
            try {
                processor.processPending()
                messageProcessor.processPending()
                Thread.sleep(COMMAND_POLL_MS)
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
            } catch (_: Exception) {
                Thread.sleep(RETRY_DELAY_MS)
            }
        }
    }

    private fun notification(text: String): Notification {
        val open = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val stop = PendingIntent.getService(
            this,
            1,
            Intent(this, MinaGatewayService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_notify_chat)
            .setContentTitle("Mina Vision")
            .setContentText(text)
            .setContentIntent(open)
            .setOngoing(true)
            .addAction(Notification.Action.Builder(null, "Arrêter", stop).build())
            .build()
    }

    private fun createNotificationChannel() {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "Passerelle Mina Vision", NotificationManager.IMPORTANCE_LOW),
        )
    }

    private fun updateNotification(text: String) {
        if (android.os.Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification(text))
    }

    companion object {
        const val ACTION_STOP = "fr.mina.gateway.action.STOP"
        const val NOTIFICATION_ID = 41
        private const val CHANNEL_ID = "mina_gateway"
        private const val RETRY_DELAY_MS = 5_000L
        private const val COMMAND_POLL_MS = 250L
    }
}
