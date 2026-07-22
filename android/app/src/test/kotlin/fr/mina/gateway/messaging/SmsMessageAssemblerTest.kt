package fr.mina.gateway.messaging

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SmsMessageAssemblerTest {
    @Test
    fun reconstructsMultipartSmsInOrder() {
        val result = SmsMessageAssembler.assemble(
            listOf(
                SmsPart("+33600000000", "Bonjour ", 1234L),
                SmsPart("+33600000000", "Mina", 1235L),
            ),
        )

        assertEquals("+33600000000", result?.sender)
        assertEquals("Bonjour Mina", result?.body)
        assertEquals(1234L, result?.sentAtMs)
    }

    @Test
    fun rejectsMixedSendersAndOversizedPayloads() {
        assertNull(
            SmsMessageAssembler.assemble(
                listOf(SmsPart("+33600000000", "a", 1L), SmsPart("+33700000000", "b", 2L)),
            ),
        )
        assertNull(SmsMessageAssembler.assemble(listOf(SmsPart("+33600000000", "x".repeat(5000), 1L))))
    }
}
