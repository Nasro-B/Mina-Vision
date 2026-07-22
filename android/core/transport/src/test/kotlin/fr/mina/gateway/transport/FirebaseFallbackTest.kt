package fr.mina.gateway.transport

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class FirebaseFallbackTest {
    @Test
    fun storesCiphertextWithBoundedTtlAndNoCapabilities() {
        val records = mutableMapOf<String, FirebaseEnvelope>()
        val backend = object : FirebaseEnvelopeStore {
            override fun put(value: FirebaseEnvelope) { records[value.id] = value }
            override fun get(id: String): FirebaseEnvelope? = records[id]
            override fun remove(id: String) { records.remove(id) }
        }
        val fallback = FirebaseFallback(backend) { 1_000L }
        val record = FirebaseEnvelope("env-1", "sms.message", 0, 3_600_000, "cipher", "nonce", "tag", "signature")
        fallback.enqueue(record, directTransportAvailable = false)
        assertEquals(emptySet<String>(), fallback.receive("env-1").capabilities)
        assertEquals(true, fallback.receive("env-1").duplicate)
        assertThrows(IllegalArgumentException::class.java) {
            fallback.enqueue(record.copy(id = "long", expiresAtEpochMs = 172_800_001), false)
        }
        assertThrows(IllegalArgumentException::class.java) {
            fallback.enqueue(record.copy(id = "face", kind = "face.embedding"), false)
        }
    }
}
