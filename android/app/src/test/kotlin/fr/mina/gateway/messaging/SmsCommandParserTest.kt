package fr.mina.gateway.messaging

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.nio.file.Files

class SmsCommandParserTest {
    @Test
    fun acceptsOnlyFreshExplicitlyConfirmedReply() {
        val command = SmsCommandParser.parse(
            """{"version":1,"id":"cmd-0123456789abcdef0123456789abcdef","action":"sms.send","sourceMessageId":"sms-42","recipientE164":"+33600000000","text":"Bien reçu","confirmed":true,"createdAtMs":1000,"expiresAtMs":61000}""",
            nowMs = 2_000L,
        )

        assertEquals("sms-42", command.sourceMessageId)
        assertEquals("+33600000000", command.recipientE164)
        assertEquals("Bien reçu", command.text)
    }

    @Test
    fun rejectsUnconfirmedExpiredOrUnknownCommands() {
        val base = """{"version":1,"id":"cmd-0123456789abcdef0123456789abcdef","action":"sms.send","sourceMessageId":"sms-42","recipientE164":"+33600000000","text":"Bien reçu","confirmed":true,"createdAtMs":1000,"expiresAtMs":61000}"""

        assertThrows(IllegalArgumentException::class.java) {
            SmsCommandParser.parse(base.replace("\"confirmed\":true", "\"confirmed\":false"), 2_000L)
        }
        assertThrows(IllegalArgumentException::class.java) { SmsCommandParser.parse(base, 62_000L) }
        assertThrows(IllegalArgumentException::class.java) {
            SmsCommandParser.parse(base.replace("sms.send", "computer.click"), 2_000L)
        }
    }

    @Test
    fun fileProcessorDeletesCommandAndWritesNonSensitiveReceipt() {
        val root = Files.createTempDirectory("mina-sms-command").toFile()
        val commands = root.resolve("commands").apply { mkdirs() }
        val id = "cmd-0123456789abcdef0123456789abcdef"
        commands.resolve("$id.json").writeText(
            """{"version":1,"id":"$id","action":"sms.send","sourceMessageId":"sms-42","recipientE164":"+33600000000","text":"Bien reçu","confirmed":true,"createdAtMs":1000,"expiresAtMs":61000}""",
        )
        val dispatched = mutableListOf<SmsCommand>()
        val processor = SmsCommandFileProcessor(
            root,
            SmsCommandDispatcher { command -> dispatched += command; SmsCommandReceipt(command.id, "queued") },
            now = { 2_000L },
        )

        assertEquals(1, processor.processPending())
        assertEquals(listOf(id), dispatched.map { it.id })
        assertEquals(false, commands.resolve("$id.json").exists())
        val receipt = root.resolve("receipts/$id.json").readText()
        assertEquals(false, receipt.contains("Bien reçu"))
        assertEquals(false, receipt.contains("+33600000000"))
    }
}
