package fr.mina.gateway.protocol

import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Test
import java.security.KeyFactory
import java.security.spec.PKCS8EncodedKeySpec
import java.security.spec.X509EncodedKeySpec

/**
 * Même vecteur que Node (`tests/fixtures/protocol/mina-chat-device-wrap-vectors.json`).
 * Si un côté change sa dérivation, ce test casse — au lieu d'un appairage qui échoue en
 * silence sur un vrai téléphone.
 */
class ChatDeviceWrapTest {
    private val vectors: JSONObject by lazy {
        val stream = javaClass.classLoader!!.getResourceAsStream("mina-chat-device-wrap-vectors.json")
            ?: error("vecteur d'enveloppement introuvable")
        JSONObject(stream.bufferedReader().readText())
    }

    private fun hex(value: String): ByteArray =
        value.chunked(2).map { it.toInt(16).toByte() }.toByteArray()

    private fun toHex(value: ByteArray): String =
        value.joinToString("") { "%02x".format(it) }

    private fun privateKey(hexValue: String) =
        KeyFactory.getInstance("EC").generatePrivate(PKCS8EncodedKeySpec(hex(hexValue)))

    private fun publicKey(hexValue: String) =
        KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(hex(hexValue)))

    @Test
    fun `derive exactement la meme cle que Node`() {
        val deviceId = vectors.getString("deviceId")
        val fromDevice = ChatCrypto.deriveDeviceWrapKey(
            privateKey = privateKey(vectors.getString("devicePrivatePkcs8Hex")),
            peerPublicKey = publicKey(vectors.getString("pcPublicSpkiHex")),
            deviceId = deviceId,
        )
        assertEquals(vectors.getString("expectedWrapKeyHex"), toHex(fromDevice))
    }

    @Test
    fun `les deux cotes convergent`() {
        val deviceId = vectors.getString("deviceId")
        val fromPc = ChatCrypto.deriveDeviceWrapKey(
            privateKey = privateKey(vectors.getString("pcPrivatePkcs8Hex")),
            peerPublicKey = publicKey(vectors.getString("devicePublicSpkiHex")),
            deviceId = deviceId,
        )
        val fromDevice = ChatCrypto.deriveDeviceWrapKey(
            privateKey = privateKey(vectors.getString("devicePrivatePkcs8Hex")),
            peerPublicKey = publicKey(vectors.getString("pcPublicSpkiHex")),
            deviceId = deviceId,
        )
        assertArrayEquals(fromPc, fromDevice)
    }

    @Test
    fun `un autre identifiant d appareil donne une autre cle`() {
        val samsung = ChatCrypto.deriveDeviceWrapKey(
            privateKey = privateKey(vectors.getString("devicePrivatePkcs8Hex")),
            peerPublicKey = publicKey(vectors.getString("pcPublicSpkiHex")),
            deviceId = "device-samsung",
        )
        val huawei = ChatCrypto.deriveDeviceWrapKey(
            privateKey = privateKey(vectors.getString("devicePrivatePkcs8Hex")),
            peerPublicKey = publicKey(vectors.getString("pcPublicSpkiHex")),
            deviceId = "device-huawei",
        )
        assertFalse(samsung.contentEquals(huawei))
    }

    @Test
    fun `la cle derivee ouvre reellement une cle d epoque enveloppee par le PC`() {
        val deviceId = vectors.getString("deviceId")
        val epochKey = ChatCrypto.randomKey()
        val pcSide = ChatCrypto.deriveDeviceWrapKey(
            privateKey = privateKey(vectors.getString("pcPrivatePkcs8Hex")),
            peerPublicKey = publicKey(vectors.getString("devicePublicSpkiHex")),
            deviceId = deviceId,
        )
        val wrapped = ChatCrypto.wrapEpochKey(pcSide, epochKey, deviceId, 1)

        val deviceSide = ChatCrypto.deriveDeviceWrapKey(
            privateKey = privateKey(vectors.getString("devicePrivatePkcs8Hex")),
            peerPublicKey = publicKey(vectors.getString("pcPublicSpkiHex")),
            deviceId = deviceId,
        )
        assertArrayEquals(epochKey, ChatCrypto.unwrapEpochKey(deviceSide, wrapped, deviceId, 1))
    }

    @Test
    fun `refuse une derivation sans identifiant`() {
        assertThrows(IllegalArgumentException::class.java) {
            ChatCrypto.deriveDeviceWrapKey(
                privateKey = privateKey(vectors.getString("devicePrivatePkcs8Hex")),
                peerPublicKey = publicKey(vectors.getString("pcPublicSpkiHex")),
                deviceId = "",
            )
        }
    }
}
