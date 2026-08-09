package fr.mina.gateway.chat

import fr.mina.gateway.protocol.AssistantResponseFrame
import fr.mina.gateway.protocol.AssistantResponseStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatResponseStreamAssemblerTest {
    @Test
    fun `assemble les fragments ordonnes uniquement en memoire puis les efface au final`() {
        val assembler = ChatResponseStreamAssembler()

        assertEquals(
            ChatStreamingResponse(RESPONSE_ID, SOURCE_EVENT_ID, ""),
            assembler.accept(started()),
        )
        assertEquals(
            ChatStreamingResponse(RESPONSE_ID, SOURCE_EVENT_ID, "Bon"),
            assembler.accept(chunk(sequence = 1, text = "Bon")),
        )
        assertEquals(
            ChatStreamingResponse(RESPONSE_ID, SOURCE_EVENT_ID, "Bonjour"),
            assembler.accept(chunk(sequence = 2, text = "jour")),
        )

        assertEquals(
            listOf(ChatStreamingResponse(RESPONSE_ID, SOURCE_EVENT_ID, "Bonjour")),
            assembler.responses.value,
        )

        assertEquals(null, assembler.accept(completed(sequence = 3, text = "Bonjour !")))

        assertTrue(assembler.responses.value.isEmpty())
    }

    @Test
    fun `attend un fragment manquant, le dedoublonne et reprend dans l ordre`() {
        val assembler = ChatResponseStreamAssembler()

        assembler.accept(started())
        assembler.accept(chunk(sequence = 2, text = "jour"))
        assertEquals(listOf(ChatStreamingResponse(RESPONSE_ID, SOURCE_EVENT_ID, "")), assembler.responses.value)

        assembler.accept(chunk(sequence = 1, text = "Bon"))
        assertEquals(
            ChatStreamingResponse(RESPONSE_ID, SOURCE_EVENT_ID, "Bonjour"),
            assembler.accept(chunk(sequence = 1, text = "Bon")),
        )

        assertEquals(
            listOf(ChatStreamingResponse(RESPONSE_ID, SOURCE_EVENT_ID, "Bonjour")),
            assembler.responses.value,
        )
    }

    @Test
    fun `un terminal d une autre demande ne peut pas effacer une reponse en cours`() {
        val assembler = ChatResponseStreamAssembler()

        assembler.accept(started())
        assembler.accept(chunk(sequence = 1, text = "Bon"))
        assembler.accept(completed(sourceEventId = OTHER_SOURCE_EVENT_ID, sequence = 2, text = "autre"))

        assertEquals(
            listOf(ChatStreamingResponse(RESPONSE_ID, SOURCE_EVENT_ID, "Bon")),
            assembler.responses.value,
        )
    }

    @Test
    fun `ne garde jamais plus de 32 Kio de fragments meme avec un trou de sequence`() {
        val assembler = ChatResponseStreamAssembler()
        val fullChunk = "x".repeat(AssistantResponseStream.MAX_CHUNK_BYTES)

        assembler.accept(started())
        for (sequence in 2..5) assembler.accept(chunk(sequence, fullChunk))
        assembler.accept(chunk(sequence = 1, text = "x"))

        assertTrue(assembler.responses.value.isEmpty())
    }

    private fun started(): AssistantResponseFrame = AssistantResponseFrame(
        type = "assistant.response.started",
        responseId = RESPONSE_ID,
        sourceEventId = SOURCE_EVENT_ID,
        sequence = 0,
        text = null,
        code = null,
    )

    private fun chunk(sequence: Int, text: String): AssistantResponseFrame = AssistantResponseFrame(
        type = "assistant.response.chunk",
        responseId = RESPONSE_ID,
        sourceEventId = SOURCE_EVENT_ID,
        sequence = sequence,
        text = text,
        code = null,
    )

    private fun completed(
        sourceEventId: String = SOURCE_EVENT_ID,
        sequence: Int,
        text: String,
    ): AssistantResponseFrame = AssistantResponseFrame(
        type = "assistant.response.completed",
        responseId = RESPONSE_ID,
        sourceEventId = sourceEventId,
        sequence = sequence,
        text = text,
        code = null,
    )

    private companion object {
        const val RESPONSE_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV"
        const val SOURCE_EVENT_ID = "01BX5ZZKBKACTAV9WEVGEMMVRZ"
        const val OTHER_SOURCE_EVENT_ID = "01CZ7YV6B6EV7N5FNEC5P5X5PN"
    }
}
