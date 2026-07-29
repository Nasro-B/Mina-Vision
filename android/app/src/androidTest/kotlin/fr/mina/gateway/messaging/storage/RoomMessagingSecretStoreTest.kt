package fr.mina.gateway.messaging.storage

import android.content.Context
import android.app.ActivityManager
import android.app.NotificationManager
import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.util.Base64
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import fr.mina.gateway.messaging.GatewayServiceStartPolicy
import fr.mina.gateway.messaging.TelegramGateway
import fr.mina.gateway.messaging.MinaGatewayService
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class RoomMessagingSecretStoreTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val database = Room.inMemoryDatabaseBuilder(context, MessagingDatabase::class.java)
        .allowMainThreadQueries()
        .build()

    @After
    fun closeDatabase() = database.close()

    @Test
    fun storesTokenAndOwnerIdentityOnlyAsCiphertext() {
        val cipher = PrefixCipher()
        val store = RoomMessagingSecretStore(database.secretDao(), cipher)
        val token = "123456789:telegram-test-token".toCharArray()

        store.put("telegram_bot_token", token)
        store.put("owner_phone_e164", "+33600000000".toCharArray())
        store.put("owner_telegram_user_ids", "[111,222]".toCharArray())

        assertTrue(token.all { it == '\u0000' })
        val rawRows = database.secretDao().allForTest()
        assertTrue(rawRows.size == 3)
        val raw = rawRows.joinToString("|") { "${it.nameCiphertext}:${it.valueCiphertext}" }
        assertFalse(raw.contains("telegram-test-token"))
        assertFalse(raw.contains("+33600000000"))
        assertFalse(raw.contains("111"))
        assertArrayEquals(
            "123456789:telegram-test-token".toCharArray(),
            store.get("telegram_bot_token"),
        )
    }

    @Test
    fun androidKeystoreCipherRoundTripsWithoutEmbeddingPlaintext() {
        val cipher = AndroidKeystoreFieldCipher()
        val plaintext = "secret-huawei-message".toCharArray()
        val encrypted = cipher.encrypt("test-message", plaintext)

        assertFalse(encrypted.contains("secret-huawei-message"))
        assertArrayEquals(plaintext, cipher.decrypt("test-message", encrypted))
    }

    @Test
    fun persistsInboundSmsIdempotentlyWithEncryptedSenderAndBody() {
        val repository = EncryptedMessageRepository(database.messageDao(), PrefixCipher())
        val first = repository.storeInboundSms("+33600000000", "Bonjour Mina", 1234L)
        val duplicate = repository.storeInboundSms("+33600000000", "Bonjour Mina", 1234L)

        assertTrue(first)
        assertFalse(duplicate)
        val raw = database.messageDao().allForTest().single()
        assertFalse(raw.senderCiphertext.contains("+33600000000"))
        assertFalse(raw.bodyCiphertext.contains("Bonjour Mina"))
        assertTrue(raw.channel == "sms")
    }

    @Test
    fun provisionsAndReloadsOwnerAndTelegramTokenThroughEncryptedRoom() {
        val secrets = RoomMessagingSecretStore(database.secretDao(), AndroidKeystoreFieldCipher())
        val identities = EncryptedOwnerIdentityStore(secrets)
        identities.save("+33600000000", setOf(111L, 222L), locallyConfirmed = true)
        val owner = requireNotNull(identities.load())
        val token = "123456789:telegram-test-token".toCharArray()

        TelegramGateway(owner, secrets).provisionToken(token, locallyConfirmed = true)

        assertTrue(token.all { it == '\u0000' })
        assertTrue(secrets.has("telegram_bot_token"))
        assertTrue(owner.ownsTelegram(111L))
        assertTrue(owner.ownsTelegram(222L))
    }

    @Test
    fun startsGatewayServiceOnlyFromTheApplicationUid() {
        context.startForegroundService(
            Intent(context, MinaGatewayService::class.java)
                .putExtra(GatewayServiceStartPolicy.EXTRA_ISOLATED_TEST_MODE, true),
        )
        val manager = context.getSystemService(ActivityManager::class.java)
        val notifications = context.getSystemService(NotificationManager::class.java)
        val notificationsGranted = context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        var running = false
        var foreground = false
        repeat(50) {
            running = manager.getRunningServices(50).any {
                it.service.className == MinaGatewayService::class.java.name
            }
            foreground = notifications.activeNotifications.any { it.id == MinaGatewayService.NOTIFICATION_ID }
            if (!running || (notificationsGranted && !foreground)) Thread.sleep(100)
        }

        assertTrue(running)
        if (notificationsGranted) assertTrue(foreground)
        assertTrue(context.stopService(Intent(context, MinaGatewayService::class.java)))
    }

    private class PrefixCipher : MessagingFieldCipher {
        override fun blindIndex(label: String): String = "idx-${label.reversed()}"

        override fun encrypt(label: String, plaintext: CharArray): String =
            Base64.encodeToString(plaintext.concatToString().toByteArray(), Base64.NO_WRAP)

        override fun decrypt(label: String, ciphertext: String): CharArray =
            Base64.decode(ciphertext, Base64.NO_WRAP).toString(Charsets.UTF_8).toCharArray()
    }
}
