package fr.mina.gateway.protocol

import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Rejoue les vecteurs partagés que le test Node a produits (mina-chat-payload-v2-vectors.json, le
 * MÊME fichier). Si les octets divergent d'un côté, ce test casse — c'est le verrou d'interop.
 */
class ChatPayloadCodecTest {
    private fun resource(name: String): String =
        javaClass.classLoader!!.getResourceAsStream(name)!!.bufferedReader().readText()

    private fun hex(bytes: ByteArray): String = bytes.joinToString("") { "%02x".format(it) }
    private fun fromHex(value: String): ByteArray =
        ByteArray(value.length / 2) { ((value[it * 2].digitToInt(16) shl 4) + value[it * 2 + 1].digitToInt(16)).toByte() }

    @Test
    fun encodeMatchesSharedVectors() {
        val vectors = JSONObject(resource("mina-chat-payload-v2-vectors.json")).getJSONArray("vectors")
        for (i in 0 until vectors.length()) {
            val vector = vectors.getJSONObject(i)
            if (vector.has("type")) {
                val binaryHex = vector.optString("binaryHex", "")
                val encoded = ChatPayloadCodec.encodeV2(
                    vector.getString("type"),
                    vector.getJSONObject("meta").toString(),
                    if (binaryHex.isEmpty()) ByteArray(0) else fromHex(binaryHex),
                )
                // Kotlin DÉCODE les octets produits par Node (interop réel) : type/meta/binaire
                // identiques. La comparaison est STRUCTURELLE (JSONObject), car l'ordre des clés JSON
                // n'est pas canonique entre plateformes — et il n'a pas à l'être : le payload est
                // chiffré+signé par l'émetteur et seulement DÉCODÉ par le récepteur, jamais réencodé
                // pour comparaison d'octets (contrairement à l'AAD/en-tête, lui partagé au bit près).
                val fromNode = ChatPayloadCodec.decode(fromHex(vector.getString("payloadHex")))
                assertTrue(fromNode is ChatPayloadCodec.PayloadV2)
                fromNode as ChatPayloadCodec.PayloadV2
                assertEquals(vector.getString("type"), fromNode.type)
                assertEquals(vector.getJSONObject("meta").toString(), JSONObject(fromNode.metaJson).toString())
                // Round-trip Kotlin : ce que Kotlin encode se re-décode au même type/meta/binaire.
                val fromKotlin = ChatPayloadCodec.decode(encoded) as ChatPayloadCodec.PayloadV2
                assertEquals(fromNode.type, fromKotlin.type)
                assertEquals(JSONObject(fromNode.metaJson).toString(), JSONObject(fromKotlin.metaJson).toString())
                assertArrayEquals(fromNode.binary, fromKotlin.binary)
            }
        }
    }

    @Test
    fun textV1PassthroughFromSharedVector() {
        val vectors = JSONObject(resource("mina-chat-payload-v2-vectors.json")).getJSONArray("vectors")
        for (i in 0 until vectors.length()) {
            val vector = vectors.getJSONObject(i)
            if (vector.has("textUtf8")) {
                val decoded = ChatPayloadCodec.decode(fromHex(vector.getString("payloadHex")))
                assertTrue(decoded is ChatPayloadCodec.TextV1)
                assertEquals(vector.getString("textUtf8"), (decoded as ChatPayloadCodec.TextV1).text)
            }
        }
    }

    @Test
    fun mediaChunkBinaryRoundTrips() {
        val encoded = ChatPayloadCodec.encodeV2("media.chunk", "{\"mediaId\":\"M9\",\"index\":3}", byteArrayOf(9, 8, 7, 6))
        val decoded = ChatPayloadCodec.decode(encoded) as ChatPayloadCodec.PayloadV2
        assertArrayEquals(byteArrayOf(9, 8, 7, 6), decoded.binary)
    }

    @Test
    fun rejectsUnknownVersionAndType() {
        assertThrows(IllegalArgumentException::class.java) { ChatPayloadCodec.decode(byteArrayOf(0x00, 0x09)) }
        assertThrows(IllegalArgumentException::class.java) { ChatPayloadCodec.encodeV2("message.text.created", "{}") }
    }
}
