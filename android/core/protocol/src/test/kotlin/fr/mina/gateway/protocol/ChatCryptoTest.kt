package fr.mina.gateway.protocol

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Test

/** Miroir des tests Node : mêmes garanties de chiffrement, d'enveloppement et de dérivation. */
class ChatCryptoTest {
    @Test
    fun `enveloppe et desenveloppe une cle d epoque pour le bon appareil`() {
        val deviceWrapKey = ChatCrypto.randomKey()
        val epochKey = ChatCrypto.randomKey()
        val wrapped = ChatCrypto.wrapEpochKey(deviceWrapKey, epochKey, "device-samsung", 1)
        val opened = ChatCrypto.unwrapEpochKey(deviceWrapKey, wrapped, "device-samsung", 1)
        assertArrayEquals(epochKey, opened)
    }

    @Test
    fun `refuse un autre appareil ou une autre epoque`() {
        val deviceWrapKey = ChatCrypto.randomKey()
        val wrapped = ChatCrypto.wrapEpochKey(deviceWrapKey, ChatCrypto.randomKey(), "device-samsung", 1)
        assertThrows(Exception::class.java) {
            ChatCrypto.unwrapEpochKey(deviceWrapKey, wrapped, "device-huawei", 1)
        }
        assertThrows(Exception::class.java) {
            ChatCrypto.unwrapEpochKey(deviceWrapKey, wrapped, "device-samsung", 2)
        }
        assertThrows(Exception::class.java) {
            ChatCrypto.unwrapEpochKey(ChatCrypto.randomKey(), wrapped, "device-samsung", 1)
        }
    }

    @Test
    fun `exige des cles de 32 octets`() {
        assertThrows(IllegalArgumentException::class.java) {
            ChatCrypto.wrapEpochKey(ByteArray(16), ChatCrypto.randomKey(), "d", 1)
        }
        assertThrows(IllegalArgumentException::class.java) {
            ChatCrypto.wrapEpochKey(ChatCrypto.randomKey(), ByteArray(16), "d", 1)
        }
    }

    @Test
    fun `derive une cle distincte et deterministe par piece jointe`() {
        val epochKey = ChatCrypto.randomKey()
        val first = ChatCrypto.deriveAttachmentKey(epochKey, "att-1")
        val second = ChatCrypto.deriveAttachmentKey(epochKey, "att-2")
        assertEquals(32, first.size)
        assertFalse(first.contentEquals(second))
        assertArrayEquals(first, ChatCrypto.deriveAttachmentKey(epochKey, "att-1"))
    }

    @Test
    fun `une autre epoque donne une autre cle de piece jointe`() {
        val first = ChatCrypto.deriveAttachmentKey(ChatCrypto.randomKey(), "att-1")
        val second = ChatCrypto.deriveAttachmentKey(ChatCrypto.randomKey(), "att-1")
        assertFalse(first.contentEquals(second))
    }
}
