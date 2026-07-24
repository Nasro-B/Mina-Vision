package fr.mina.gateway.chat

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
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
    fun `l outbox ne rend que les envois dus — la temporisation est respectee`() = runTest {
        val eventId = repository.sendText("thread-main", "bonjour")
        db.chatDao().rescheduleOutbox(eventId, attempts = 1, nextAtMs = clock + 60_000, error = "hors_ligne")
        assertTrue(db.chatDao().dueOutbox(clock, limit = 10).isEmpty())
        assertEquals(1, db.chatDao().dueOutbox(clock + 60_000, limit = 10).size)
    }
}
