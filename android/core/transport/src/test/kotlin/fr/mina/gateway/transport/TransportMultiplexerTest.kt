package fr.mina.gateway.transport

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class TransportMultiplexerTest {
    private class FakeEndpoint(
        override val endpointId: String,
        override val type: TransportType,
        private var fail: Boolean = false,
        private val order: MutableList<String>,
    ) : TransportEndpoint {
        override fun send(envelope: TransportEnvelope): DeliveryReceipt {
            order += "$type:${envelope.id}"
            if (fail) throw IllegalStateException("down")
            return DeliveryReceipt(envelope.id, true)
        }
    }

    @Test
    fun prioritizesControlAndFailsOverFromUsbToLan() {
        val order = mutableListOf<String>()
        val multiplexer = TransportMultiplexer(mapOf(QueueKind.CONTROL to 2, QueueKind.MESSAGE to 2, QueueKind.MEDIA to 2))
        multiplexer.connect(FakeEndpoint("lan", TransportType.LAN, order = order), "huawei-primary", true)
        multiplexer.connect(FakeEndpoint("usb", TransportType.USB, fail = true, order = order), "huawei-primary", true)
        multiplexer.enqueue(QueueKind.MEDIA, TransportEnvelope("media-1"))
        multiplexer.enqueue(QueueKind.CONTROL, TransportEnvelope("control-1"))

        assertEquals("control-1", multiplexer.drainOne().envelopeId)
        assertEquals("media-1", multiplexer.drainOne().envelopeId)
        assertEquals(listOf("USB:control-1", "LAN:control-1", "LAN:media-1"), order)
    }

    @Test
    fun rejectsUntrustedPeersBackpressureCancellationAndDuplicates() {
        val order = mutableListOf<String>()
        val multiplexer = TransportMultiplexer(mapOf(QueueKind.CONTROL to 1, QueueKind.MESSAGE to 1, QueueKind.MEDIA to 1))
        assertThrows(IllegalArgumentException::class.java) {
            multiplexer.connect(FakeEndpoint("bad", TransportType.USB, order = order), "intruder", false)
        }
        multiplexer.connect(FakeEndpoint("usb", TransportType.USB, order = order), "huawei-primary", true)
        multiplexer.enqueue(QueueKind.MESSAGE, TransportEnvelope("message-1"))
        assertThrows(IllegalStateException::class.java) {
            multiplexer.enqueue(QueueKind.MESSAGE, TransportEnvelope("message-2"))
        }
        multiplexer.cancel("message-1")
        assertThrows(IllegalStateException::class.java) { multiplexer.drainOne() }
        multiplexer.enqueue(QueueKind.CONTROL, TransportEnvelope("once"))
        multiplexer.drainOne()
        assertEquals(false, multiplexer.enqueue(QueueKind.CONTROL, TransportEnvelope("once")))
    }
}
