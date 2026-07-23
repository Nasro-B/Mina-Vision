package fr.mina.gateway.protocol

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Test

/**
 * LE test d'interopérabilité : Kotlin doit produire exactement l'AAD hexadécimal figé dans
 * `mina-chat-codec-vectors.json`, le même fichier que lit le test Node. Si ce test passe des
 * deux côtés, une signature calculée sur PC vérifie sur Android et réciproquement.
 */
class ChatBinaryCodecTest {
    private fun resource(name: String): String {
        val stream = javaClass.classLoader!!.getResourceAsStream(name)
        requireNotNull(stream) { "fixture $name introuvable" }
        return stream.bufferedReader().readText()
    }

    private fun event(): ChatEvent = ChatEventCodec.decode(JSONObject(resource("mina-chat-event-v2.json")))
    private fun vectors(): JSONObject = JSONObject(resource("mina-chat-codec-vectors.json"))

    @Test
    fun `produit exactement l AAD du vecteur partage avec Node`() {
        val expected = vectors().getString("aadHex")
        assertEquals(expected, ChatBinaryCodec.toHex(ChatBinaryCodec.encodeHeader(event())))
    }

    @Test
    fun `produit une entree de signature de la longueur attendue`() {
        val expected = vectors().getInt("signatureInputLength")
        assertEquals(expected, ChatBinaryCodec.encodeSignatureInput(event()).size)
    }

    @Test
    fun `l AAD change des qu un seul champ du contexte change`() {
        val base = ChatBinaryCodec.toHex(ChatBinaryCodec.encodeHeader(event()))
        val patches = listOf(
            event().copy(threadId = "thread-autre"),
            event().copy(senderDeviceId = "device-huawei"),
            event().copy(deviceSequence = 2),
            event().copy(keyEpoch = 2),
            event().copy(routingClass = "control"),
            event().copy(createdAtMs = event().createdAtMs + 1),
            event().copy(expiresAtMs = event().expiresAtMs + 1),
        )
        for (patched in patches) {
            assertNotEquals(base, ChatBinaryCodec.toHex(ChatBinaryCodec.encodeHeader(patched)))
        }
    }

    @Test
    fun `ne confond jamais deux champs voisins`() {
        // Sans préfixe de longueur, « ab » + « c » et « a » + « bc » donneraient les mêmes octets.
        val first = ChatBinaryCodec.encodeHeader(event().copy(threadId = "ab", senderDeviceId = "c"))
        val second = ChatBinaryCodec.encodeHeader(event().copy(threadId = "a", senderDeviceId = "bc"))
        assertNotEquals(ChatBinaryCodec.toHex(first), ChatBinaryCodec.toHex(second))
    }

    @Test
    fun `refuse un champ demesure avant toute allocation`() {
        assertThrows(IllegalArgumentException::class.java) {
            ChatBinaryCodec.encodeHeader(event().copy(threadId = "x".repeat(5_000)))
        }
    }
}
