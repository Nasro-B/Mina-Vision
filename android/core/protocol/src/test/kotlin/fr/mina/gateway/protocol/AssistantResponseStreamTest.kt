package fr.mina.gateway.protocol

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

class AssistantResponseStreamTest {
    private companion object {
        const val RESPONSE_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV"
        const val SOURCE_EVENT_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAW"
    }

    @Test
    fun `conserve la correlation et les sequences du debut a la fin`() {
        val started = AssistantResponseStream.decode(
            ChatPayloadCodec.decode(AssistantResponseStream.encodeStarted(RESPONSE_ID, SOURCE_EVENT_ID))
                as ChatPayloadCodec.PayloadV2,
        )
        val chunk = AssistantResponseStream.decode(
            ChatPayloadCodec.decode(AssistantResponseStream.encodeChunk(RESPONSE_ID, SOURCE_EVENT_ID, 1, "bon"))
                as ChatPayloadCodec.PayloadV2,
        )
        val completed = AssistantResponseStream.decode(
            ChatPayloadCodec.decode(AssistantResponseStream.encodeCompleted(RESPONSE_ID, SOURCE_EVENT_ID, 2, "bonjour"))
                as ChatPayloadCodec.PayloadV2,
        )

        assertEquals("assistant.response.started", started.type)
        assertEquals(0, started.sequence)
        assertNull(started.text)
        assertEquals("assistant.response.chunk", chunk.type)
        assertEquals("bon", chunk.text)
        assertEquals("assistant.response.completed", completed.type)
        assertEquals("bonjour", completed.text)
    }

    @Test
    fun `refuse un fragment ambigu une sequence initiale invalide et un identifiant invalide`() {
        assertThrows(IllegalArgumentException::class.java) {
            AssistantResponseStream.encodeStarted(RESPONSE_ID, SOURCE_EVENT_ID, "ne doit pas exister")
        }
        assertThrows(IllegalArgumentException::class.java) {
            AssistantResponseStream.encodeChunk(RESPONSE_ID, SOURCE_EVENT_ID, 0, "bon")
        }
        assertThrows(IllegalArgumentException::class.java) {
            AssistantResponseStream.encodeCompleted("not-ulid", SOURCE_EVENT_ID, 2, "bonjour")
        }
    }

    @Test
    fun `encode un echec borne sans corps en clair`() {
        val failed = AssistantResponseStream.decode(
            ChatPayloadCodec.decode(AssistantResponseStream.encodeFailed(RESPONSE_ID, SOURCE_EVENT_ID, 3, "provider_timeout"))
                as ChatPayloadCodec.PayloadV2,
        )

        assertEquals("assistant.response.failed", failed.type)
        assertEquals(3, failed.sequence)
        assertNull(failed.text)
        assertEquals("provider_timeout", failed.code)
        assertThrows(IllegalArgumentException::class.java) {
            AssistantResponseStream.encodeFailed(RESPONSE_ID, SOURCE_EVENT_ID, 3, "provider_detail_unbounded")
        }
    }
}
