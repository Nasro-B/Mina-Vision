package fr.mina.gateway.chat

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import fr.mina.gateway.protocol.VoicePcmFormat
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import java.io.IOException
import java.nio.file.Files
import java.security.SecureRandom

/**
 * Stockage local du chat — sur vraie base SQLite (Robolectric), pas sur une imitation :
 * la déduplication et l'atomicité testées ici sont des garanties de Room, une fausse DAO
 * ne prouverait rien.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ChatRepositoryTest {
    private lateinit var db: ChatDatabase
    private lateinit var repository: ChatRepository
    private val epochKey = ByteArray(32).also { SecureRandom().nextBytes(it) }
    private var locked = false
    private var clock = 1_784_732_400_000L

    @Before
    fun setUp() {
        db = Room.inMemoryDatabaseBuilder(
            ApplicationProvider.getApplicationContext(),
            ChatDatabase::class.java,
        ).build()
        repository = ChatRepository(
            dao = db.chatDao(),
            deviceId = "device-samsung",
            now = { clock },
            epochKeyProvider = { epoch -> if (locked || epoch != 1) null else epochKey },
        )
    }

    @After
    fun tearDown() = db.close()

    @Test
    fun `le texte en clair n'est JAMAIS ecrit dans la base`() = runTest {
        val secret = "code de la porte 4821"
        repository.sendText("thread-main", secret)

        val stored = db.chatDao().readThread("thread-main").single()
        assertFalse(stored.payloadCiphertext.contains("4821"))
        assertFalse(String(android.util.Base64.decode(stored.payloadCiphertext, android.util.Base64.DEFAULT)).contains("porte"))
        // Relu par le dépôt : le clair réapparaît uniquement en mémoire.
        assertEquals(secret, repository.observeThread("thread-main").first().single().text)
    }

    @Test
    fun `un message sortant est ecrit AVEC sa ligne d outbox — jamais l un sans l autre`() = runTest {
        val eventId = repository.sendText("thread-main", "bonjour")
        assertEquals(1, repository.pendingCount())
        assertEquals(DeliveryState.LOCAL_PENDING, db.chatDao().findEvent(eventId)?.deliveryState)
    }

    @Test
    fun `l accuse du PC vide l outbox — le message ne repart pas en boucle`() = runTest {
        val eventId = repository.sendText("thread-main", "bonjour")
        repository.markDelivered(eventId, DeliveryState.COMPLETED)
        assertEquals(0, repository.pendingCount())
        assertEquals(DeliveryState.COMPLETED, db.chatDao().findEvent(eventId)?.deliveryState)
    }

    @Test
    fun `retry remet le meme evenement en file apres un echec final`() = runTest {
        val eventId = repository.sendText("thread-main", "bonjour")
        val original = db.chatDao().findEvent(eventId)!!
        db.chatDao().updateDeliveryState(eventId, DeliveryState.FAILED_FINAL)
        db.chatDao().dequeue(eventId)

        repository.retryFailedMessage(eventId)

        val retried = db.chatDao().findEvent(eventId)!!
        assertEquals(original.payloadCiphertext, retried.payloadCiphertext)
        assertEquals(DeliveryState.LOCAL_PENDING, retried.deliveryState)
        val outbox = db.chatDao().dueOutbox(clock, 10)
        assertEquals(listOf(eventId), outbox.map { it.eventId })
        assertEquals(0, outbox.single().attemptCount)
        assertEquals(null, outbox.single().lastError)
        assertEquals(listOf(eventId), db.chatDao().readThread("thread-main").map { it.eventId })
        val duplicateRetry = runCatching { repository.retryFailedMessage(eventId) }.exceptionOrNull()
        assertEquals("chat_retry_non_reessayable", duplicateRetry?.message)
        assertEquals(1, repository.pendingCount())
    }

    @Test
    fun `retry refuse un message deja recu par le PC`() = runTest {
        val eventId = repository.sendText("thread-main", "bonjour")
        repository.markDelivered(eventId, DeliveryState.PC_RECEIVED)

        val error = runCatching { repository.retryFailedMessage(eventId) }.exceptionOrNull()

        assertEquals("chat_retry_non_reessayable", error?.message)
        assertEquals(0, repository.pendingCount())
    }

    @Test
    fun `retry refuse un evenement recu de Mina`() = runTest {
        val eventId = repository.sendText("thread-main", "bonjour")
        val assistantEvent = db.chatDao().findEvent(eventId)!!.copy(
            eventId = "assistant-event",
            deliveryState = DeliveryState.FAILED_FINAL,
            fromAssistant = true,
        )
        db.chatDao().dequeue(eventId)
        db.chatDao().insertEvent(assistantEvent)

        val error = runCatching { repository.retryFailedMessage(assistantEvent.eventId) }.exceptionOrNull()

        assertEquals("chat_retry_non_reessayable", error?.message)
        assertEquals(0, repository.pendingCount())
    }

    @Test
    fun `le meme evenement livre deux fois n apparait qu une seule fois`() = runTest {
        val eventId = repository.sendText("thread-main", "bonjour")
        val row = db.chatDao().findEvent(eventId)!!

        // Direct ET Firebase livrent la même réponse : une seule doit rester visible.
        repository.ingest(row.toEvent(), fromAssistant = true)
        repository.ingest(row.toEvent(), fromAssistant = true)
        assertEquals(1, db.chatDao().readThread("thread-main").size)
    }

    @Test
    fun `coffre verrouille — on annonce le verrou, on n invente pas de contenu`() = runTest {
        repository.sendText("thread-main", "message secret")
        locked = true
        val text = repository.observeThread("thread-main").first().single().text
        assertTrue(text.contains("Verrouillé"))
        assertFalse(text.contains("secret"))
    }

    @Test
    fun `une autre epoque rend le message illisible sans le faire disparaitre`() = runTest {
        repository.sendText("thread-main", "message d'époque 1")
        val row = db.chatDao().readThread("thread-main").single()
        db.chatDao().insertEvent(row.copy(eventId = "01ARZ3NDEKTSV4RRFFQ69G5FAV", keyEpoch = 9))

        val messages = repository.observeThread("thread-main").first()
        assertEquals(2, messages.size)
        // L'événement d'une époque révoquée reste listé — l'historique ne ment pas par omission.
        assertTrue(messages.any { it.text.contains("illisible") || it.text.contains("Verrouillé") })
    }

    @Test
    fun `refuse un message vide plutot que d ecrire une ligne inutile`() = runTest {
        val error = runCatching { repository.sendText("thread-main", "   ") }.exceptionOrNull()
        assertEquals("chat_message_vide", error?.message)
        assertEquals(0, repository.pendingCount())
    }

    @Test
    fun `normalise les bornes sans modifier les retours a la ligne internes`() = runTest {
        repository.sendText("thread-main", "\n  premiere ligne\nseconde ligne  \n")

        assertEquals(
            "premiere ligne\nseconde ligne",
            repository.observeThread("thread-main").first().single().text,
        )
    }

    @Test
    fun `refuse un texte dont UTF-8 depasse 32 KiB avant ecriture`() = runTest {
        val tooLong = "é".repeat(16_385) // 32 770 octets UTF-8

        val error = runCatching { repository.sendText("thread-main", tooLong) }.exceptionOrNull()

        assertEquals("chat_message_trop_long", error?.message)
        assertEquals(0, repository.pendingCount())
    }

    @Test
    fun `refuse d ecrire quand le coffre est verrouille`() = runTest {
        locked = true
        val error = runCatching { repository.sendText("thread-main", "bonjour") }.exceptionOrNull()
        assertEquals("chat_coffre_verrouille", error?.message)
        assertEquals(0, repository.pendingCount())
    }

    @Test
    fun `la sequence d appareil augmente strictement par fil`() = runTest {
        repository.sendText("thread-main", "un")
        clock += 1
        repository.sendText("thread-main", "deux")
        val rows = db.chatDao().readThread("thread-main")
        assertEquals(listOf(1L, 2L), rows.map { it.deviceSequence })
    }

    @Test
    fun `deux messages dans la meme milliseconde restent ordonnes`() = runTest {
        val first = repository.sendText("thread-main", "un")
        val second = repository.sendText("thread-main", "deux")
        assertNotEquals(first, second)
        assertTrue("ULID monotone attendu : $first < $second", first < second)
        assertEquals(listOf("un", "deux"), repository.observeThread("thread-main").first().map { it.text })
    }

    @Test
    fun `le fil visible garde seulement les 200 messages les plus recents`() = runTest {
        repeat(201) { index ->
            clock += 1
            repository.sendText("thread-main", "message-${index + 1}")
        }

        val visible = repository.observeThread("thread-main").first()

        assertEquals(200, visible.size)
        assertEquals("message-2", visible.first().text)
        assertEquals("message-201", visible.last().text)
    }

    @Test
    fun `les chunks media ne reduisent pas la fenetre de 200 messages visibles`() = runTest {
        repeat(199) { index ->
            clock += 1
            repository.sendText("thread-main", "message-${index + 1}")
        }
        repository.sendMedia("thread-main", ByteArray(200_000) { 7 }, "image/jpeg")

        val visible = repository.observeThread("thread-main").first()

        assertEquals(200, visible.size)
        assertEquals("message-1", visible.first().text)
        assertEquals("image", visible.last().kind)
    }

    @Test
    fun `une page ancienne contient les cinquante messages strictement precedents`() = runTest {
        repeat(151) { index ->
            clock += 1
            repository.sendText("thread-main", "message-${index + 1}")
        }

        val recent = repository.observeThreadPage("thread-main", pageSize = 50).first()
        val firstOlder = repository.loadOlderPage("thread-main", recent.messages.first(), pageSize = 50)
        val secondOlder = repository.loadOlderPage("thread-main", firstOlder.messages.first(), pageSize = 50)
        val lastOlder = repository.loadOlderPage("thread-main", secondOlder.messages.first(), pageSize = 50)

        assertEquals((102..151).map { "message-$it" }, recent.messages.map { it.text })
        assertTrue(recent.hasOlder)
        assertEquals((52..101).map { "message-$it" }, firstOlder.messages.map { it.text })
        assertTrue(firstOlder.hasOlder)
        assertEquals((2..51).map { "message-$it" }, secondOlder.messages.map { it.text })
        assertTrue(secondOlder.hasOlder)
        assertEquals(listOf("message-1"), lastOlder.messages.map { it.text })
        assertFalse(lastOlder.hasOlder)
    }

    @Test
    fun `le curseur de page departage les messages de la meme milliseconde par event id`() = runTest {
        repository.sendText("thread-main", "un")
        repository.sendText("thread-main", "deux")
        repository.sendText("thread-main", "trois")

        val recent = repository.observeThreadPage("thread-main", pageSize = 2).first()
        val older = repository.loadOlderPage("thread-main", recent.messages.first(), pageSize = 2)

        assertEquals(listOf("deux", "trois"), recent.messages.map { it.text })
        assertTrue(recent.hasOlder)
        assertEquals(listOf("un"), older.messages.map { it.text })
        assertFalse(older.hasOlder)
    }

    @Test
    fun `sendMedia refuse si le PC n annonce pas les pieces jointes — rien mis en file`() = runTest {
        val repo = ChatRepository(
            dao = db.chatDao(), deviceId = "device-samsung", now = { clock },
            epochKeyProvider = { epoch -> if (locked || epoch != 1) null else epochKey },
            peerAcceptsMedia = { false },
        )
        val error = runCatching { repo.sendMedia("thread-main", ByteArray(10) { 1 }, "image/jpeg") }.exceptionOrNull()
        assertEquals("chat_pc_sans_pieces_jointes", error?.message)
        assertEquals(0, repo.pendingCount())
    }

    @Test
    fun `sendMedia met en file la meta puis les chunks quand le PC accepte`() = runTest {
        val repo = ChatRepository(
            dao = db.chatDao(), deviceId = "device-samsung", now = { clock },
            epochKeyProvider = { epoch -> if (locked || epoch != 1) null else epochKey },
            peerAcceptsMedia = { true },
        )
        repo.sendMedia("thread-main", ByteArray(10) { 1 }, "image/jpeg")
        // 10 octets tiennent en 1 chunk : 1 méta (payload v2) + 1 chunk = 2 lignes d'outbox.
        assertEquals(2, repo.pendingCount())
    }

    @Test
    fun `la meme reprise de note vocale ne duplique pas les event ids`() = runTest {
        val root = Files.createTempDirectory("mina-voice-retry-test-").toFile()
        try {
            val failingDao = FailingOutgoingDao(db.chatDao())
            val store = EncryptedAttachmentStore(
                root = root,
                epochKeyProvider = { epoch -> if (epoch == 1) epochKey.copyOf() else null },
                currentEpoch = { 1 },
            )
            val repo = ChatRepository(
                dao = failingDao,
                deviceId = "device-samsung",
                now = { clock },
                epochKeyProvider = { epoch -> if (locked || epoch != 1) null else epochKey },
                attachmentStore = store,
            )
            val capture = repo.beginVoiceCapture("thread-main")
            capture.append(ByteArray(VoicePcmFormat.CHUNK_BYTES) { 1 }, VoicePcmFormat.CHUNK_BYTES)
            capture.append(ByteArray(64) { 2 }, 64)
            val completed = capture.complete(durationMs = 1_000)

            failingDao.failAfterSuccessfulOutgoingWrites = 1
            val error = runCatching { repo.enqueueVoice(completed) }.exceptionOrNull()
            assertTrue(error is IOException)
            assertEquals(3, completed.deliveryEventIds.size)
            assertEquals(1, root.listFiles()?.size)

            failingDao.failAfterSuccessfulOutgoingWrites = null
            repo.enqueueVoice(completed)

            assertEquals(3, db.chatDao().readThread("thread-main").map { it.eventId }.distinct().size)
            assertEquals(3, db.chatDao().dueOutbox(Long.MAX_VALUE, 10).map { it.eventId }.distinct().size)
            assertEquals(0, root.listFiles()?.size)
        } finally {
            root.deleteRecursively()
        }
    }

    @Test
    fun `W6 - media recu du PC - chunks masques du fil, bulle media presente, octets reassembles`() = runTest {
        // Simule la réception PC : on fabrique méta + chunks avec le chunker (payload v2), on les
        // scelle comme le PC (même AES-GCM/AAD via sendMedia du dépôt n'est pas utilisable ici car
        // sens inverse) — on passe par sealAndEnqueue indirect : sendMedia écrit méta+chunks, puis
        // on relit comme si c'était le fil. Le point prouvé : décodage payload v2 → bulle + masquage
        // + réassemblage intégral.
        repository.sendMedia("thread-main", ByteArray(200_000) { (it % 251).toByte() }, "image/jpeg")

        val visible = repository.observeThread("thread-main").first()
        // 1 méta (bulle image) visible, les 2 chunks masqués.
        assertEquals(1, visible.size)
        assertEquals("image", visible.single().kind)
        val mediaId = visible.single().mediaId!!

        val media = repository.readMediaBytes("thread-main", mediaId)!!
        assertEquals("image/jpeg", media.second)
        assertEquals(200_000, media.first.size)
        assertTrue(media.first.withIndex().all { (i, b) -> b == (i % 251).toByte() })
    }

    @Test
    fun `C2 - la purge 14j supprime les chunks expires, garde les recents et les bulles meta`() = runTest {
        repository.sendMedia("thread-main", ByteArray(200_000) { 1 }, "image/jpeg") // méta + 2 chunks « maintenant »
        // Vieillit artificiellement UN chunk au-delà de 14 jours.
        val rows = db.chatDao().readThread("thread-main")
        val oldChunk = rows.first { it.routingClass == "stream" }
        db.chatDao().insertEvent(oldChunk.copy(eventId = "01OLDCHUNKAAAAAAAAAAAAAAAA", createdAtMs = clock - 15L * 24 * 60 * 60 * 1_000))

        val purged = db.chatDao().purgeExpiredChunks(clock - 14L * 24 * 60 * 60 * 1_000)
        assertEquals(1, purged)
        val remaining = db.chatDao().readThread("thread-main")
        assertEquals(3, remaining.size) // méta + 2 chunks récents — le vieux clone a disparu
        assertTrue(remaining.any { it.routingClass == "message" })
    }

    @Test
    fun `l outbox ne rend que les envois dus — la temporisation est respectee`() = runTest {
        val eventId = repository.sendText("thread-main", "bonjour")
        db.chatDao().rescheduleOutbox(eventId, attempts = 1, nextAtMs = clock + 60_000, error = "hors_ligne")
        assertTrue(db.chatDao().dueOutbox(clock, limit = 10).isEmpty())
        assertEquals(1, db.chatDao().dueOutbox(clock + 60_000, limit = 10).size)
    }

    @Test
    fun `l outbox ordonne les evenements de la meme milliseconde par event id`() = runTest {
        db.chatDao().enqueue(OutboxRow("01ZZZZZZZZZZZZZZZZZZZZZZZZ", "thread-main", clock, 0, clock, null))
        db.chatDao().enqueue(OutboxRow("01000000000000000000000000", "thread-main", clock, 0, clock, null))

        assertEquals(
            listOf("01000000000000000000000000", "01ZZZZZZZZZZZZZZZZZZZZZZZZ"),
            db.chatDao().dueOutbox(clock, 10).map { it.eventId },
        )
    }

    private class FailingOutgoingDao(
        private val delegate: ChatDao,
    ) : ChatDao by delegate {
        var failAfterSuccessfulOutgoingWrites: Int? = null
        private var successfulOutgoingWrites = 0

        override suspend fun enqueueOutgoing(event: ChatEventRow, outbox: OutboxRow) {
            delegate.enqueueOutgoing(event, outbox)
            successfulOutgoingWrites += 1
            if (failAfterSuccessfulOutgoingWrites != null &&
                successfulOutgoingWrites > failAfterSuccessfulOutgoingWrites!!
            ) {
                throw IOException("injected_outgoing_write_failure")
            }
        }
    }
}
