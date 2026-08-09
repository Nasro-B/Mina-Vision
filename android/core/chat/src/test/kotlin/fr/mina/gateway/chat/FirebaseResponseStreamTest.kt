package fr.mina.gateway.chat

import fr.mina.gateway.protocol.ChatEvent
import fr.mina.gateway.protocol.ChatEventCodec
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.Base64

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class FirebaseResponseStreamTest {
    @Test
    fun `accepte seulement une enveloppe RTDB chiffrée non expirée après le curseur`() {
        val source = FakeSource()
        val delivered = mutableListOf<ChatEvent>()
        val stream = FirebaseResponseStream(source = source, now = { 1_000L })

        stream.watchFrames(
            ownerId = OWNER_ID,
            responseId = RESPONSE_ID,
            afterSequence = 1,
            onEvent = delivered::add,
        )
        source.emit(frame(sequence = 1, ciphertext = eventCiphertext()))
        source.emit(frame(sequence = 2, ciphertext = "texte clair interdit"))
        source.emit(frame(sequence = 2, ciphertext = eventCiphertext(), expiresAtMs = 1_000L))
        source.emit(frame(sequence = 2, ciphertext = eventCiphertext()))

        assertEquals(listOf(EVENT_ID), delivered.map(ChatEvent::eventId))
    }

    @Test
    fun `retire son listener quand le flux est termine`() {
        val source = FakeSource()
        val stream = FirebaseResponseStream(source = source, now = { 1_000L })

        stream.watchFrames(OWNER_ID, RESPONSE_ID, onEvent = {})
        assertTrue(source.active)

        stream.stop(RESPONSE_ID)

        assertFalse(source.active)
    }

    @Test
    fun `ferme le listener si RTDB annule immediatement la requete`() {
        val source = CancelOnWatchSource()
        val stream = FirebaseResponseStream(source = source, now = { 1_000L })

        stream.watchFrames(OWNER_ID, RESPONSE_ID, onEvent = {})

        assertTrue(source.closed)
    }

    private fun eventCiphertext(): String = Base64.getEncoder().encodeToString(
        ChatEventCodec.encode(
            ChatEvent(
                version = 2,
                eventId = EVENT_ID,
                threadId = "thread-main",
                senderDeviceId = "pc-mina",
                deviceSequence = 1,
                keyEpoch = 1,
                routingClass = "stream",
                createdAtMs = 900L,
                expiresAtMs = 2_000L,
                payloadCiphertext = "AQID",
                nonce = "AAECAwQFBgcICQoL",
                authTag = "AAECAwQFBgcICQoLDA0ODw==",
                signature = "MAYCAQICAQM=",
            ),
        ).toString().toByteArray(Charsets.UTF_8),
    )

    private fun frame(
        sequence: Int,
        ciphertext: String,
        expiresAtMs: Long = 2_000L,
    ) = FirebaseResponseStreamFrame(sequence, ciphertext, expiresAtMs)

    private class FakeSource : FirebaseResponseStreamSource {
        private var onFrame: ((FirebaseResponseStreamFrame) -> Unit)? = null
        var active = false
            private set

        override fun watch(
            ownerId: String,
            responseId: String,
            onFrame: (FirebaseResponseStreamFrame) -> Unit,
            onError: () -> Unit,
        ): FirebaseResponseStreamSubscription {
            this.onFrame = onFrame
            active = true
            return FirebaseResponseStreamSubscription {
                this.onFrame = null
                active = false
            }
        }

        fun emit(frame: FirebaseResponseStreamFrame) = onFrame?.invoke(frame)
    }

    private class CancelOnWatchSource : FirebaseResponseStreamSource {
        var closed = false
            private set

        override fun watch(
            ownerId: String,
            responseId: String,
            onFrame: (FirebaseResponseStreamFrame) -> Unit,
            onError: () -> Unit,
        ): FirebaseResponseStreamSubscription {
            onError()
            return FirebaseResponseStreamSubscription { closed = true }
        }
    }

    private companion object {
        const val OWNER_ID = "owner-test"
        const val RESPONSE_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV"
        const val EVENT_ID = "01BX5ZZKBKACTAV9WEVGEMMVRZ"
    }
}
