package fr.mina.gateway.protocol

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Ces tests lisent LA MÊME fixture que les tests Node (`tests/fixtures/protocol/`, montée en
 * ressources de test par le build). C'est le contrat d'interopérabilité : si une plateforme
 * accepte un événement que l'autre refuse, le chat casserait en production.
 */
class ChatEventTest {
    private fun fixture(): JSONObject {
        val stream = javaClass.classLoader!!.getResourceAsStream("mina-chat-event-v2.json")
        requireNotNull(stream) { "fixture mina-chat-event-v2.json introuvable" }
        return JSONObject(stream.bufferedReader().readText())
    }

    private fun withField(key: String, value: Any): JSONObject = fixture().put(key, value)

    @Test
    fun `accepte la fixture commune Node et Kotlin`() {
        val event = ChatEventCodec.decode(fixture())
        assertEquals(2, event.version)
        assertEquals("01ARZ3NDEKTSV4RRFFQ69G5FAV", event.eventId)
        assertEquals("message", event.routingClass)
        assertEquals(1L, event.deviceSequence)
        assertEquals(1, event.keyEpoch)
    }

    @Test
    fun `refuse un champ supplementaire`() {
        assertThrows(IllegalArgumentException::class.java) {
            ChatEventCodec.decode(fixture().put("extra", "x"))
        }
    }

    @Test
    fun `refuse une sequence nulle ou negative`() {
        assertThrows(IllegalArgumentException::class.java) { ChatEventCodec.decode(withField("deviceSequence", 0)) }
        assertThrows(IllegalArgumentException::class.java) { ChatEventCodec.decode(withField("deviceSequence", -1)) }
    }

    @Test
    fun `refuse un keyEpoch hors bornes`() {
        assertThrows(IllegalArgumentException::class.java) { ChatEventCodec.decode(withField("keyEpoch", 0)) }
        // Int_MAX reste accepté : c'est exactement la borne partagée avec Node.
        val maximum = ChatEventCodec.decode(withField("keyEpoch", Int.MAX_VALUE))
        assertEquals(Int.MAX_VALUE, maximum.keyEpoch)
    }

    @Test
    fun `refuse une expiration incoherente ou trop lointaine`() {
        val created = fixture().getLong("createdAtMs")
        assertThrows(IllegalArgumentException::class.java) {
            ChatEventCodec.decode(withField("expiresAtMs", created - 1))
        }
        assertThrows(IllegalArgumentException::class.java) {
            ChatEventCodec.decode(withField("expiresAtMs", created + 31L * 24 * 60 * 60 * 1_000))
        }
    }

    @Test
    fun `exige un eventId ULID majuscule`() {
        assertThrows(IllegalArgumentException::class.java) {
            ChatEventCodec.decode(withField("eventId", "01arz3ndektsv4rrffq69g5fav"))
        }
        assertThrows(IllegalArgumentException::class.java) {
            ChatEventCodec.decode(withField("eventId", "trop-court"))
        }
    }

    @Test
    fun `exige un nonce de 12 octets et un tag de 16 octets`() {
        assertThrows(IllegalArgumentException::class.java) {
            ChatEventCodec.decode(withField("nonce", "MDEyMzQ1Njc4OQ=="))
        }
        assertThrows(IllegalArgumentException::class.java) {
            ChatEventCodec.decode(withField("authTag", "MDEyMzQ1Njc4OWFi"))
        }
    }

    @Test
    fun `refuse une classe de routage inconnue`() {
        assertThrows(IllegalArgumentException::class.java) {
            ChatEventCodec.decode(withField("routingClass", "secret"))
        }
        // Les types précis restent chiffrés : ils ne sont jamais des classes de routage.
        assertTrue(ChatEventCodec.eventTypes.none { ChatEventCodec.routingClasses.contains(it) })
    }

    @Test
    fun `refuse une version differente de 2`() {
        assertThrows(IllegalArgumentException::class.java) { ChatEventCodec.decode(withField("version", 1)) }
    }
}
