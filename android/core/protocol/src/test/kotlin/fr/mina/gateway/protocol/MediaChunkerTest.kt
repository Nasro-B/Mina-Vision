package fr.mina.gateway.protocol

import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class MediaChunkerTest {
    @Test
    fun streamEncodersProduceCanonicalVoiceMetadataAndChunk() {
        val meta = ChatPayloadCodec.decode(
            MediaChunker.encodeMeta(
                mediaId = "voice-pcm-1",
                mime = VoicePcmFormat.MIME,
                sizeBytes = 32_001,
                sha256 = "a".repeat(64),
                chunkCount = 2,
                chunkBytes = VoicePcmFormat.CHUNK_BYTES,
                extraMeta = mapOf("durationMs" to 1_001),
            ),
        ) as ChatPayloadCodec.PayloadV2
        val chunk = ChatPayloadCodec.decode(
            MediaChunker.encodeChunk("voice-pcm-1", 1, byteArrayOf(7)),
        ) as ChatPayloadCodec.PayloadV2

        assertEquals("message.voice.created", meta.type)
        assertEquals(VoicePcmFormat.MIME, JSONObject(meta.metaJson).getString("mime"))
        assertEquals(1_001, JSONObject(meta.metaJson).getInt("durationMs"))
        assertEquals("media.chunk", chunk.type)
        assertEquals(1, JSONObject(chunk.metaJson).getInt("index"))
        assertArrayEquals(byteArrayOf(7), chunk.binary)
    }

    @Test
    fun streamMetadataRejectsTheoreticalImageAllocationOverTheLimit() {
        val error = runCatching {
            MediaChunker.encodeMeta(
                mediaId = "image-1",
                mime = "image/jpeg",
                sizeBytes = 4,
                sha256 = "a".repeat(64),
                chunkCount = 100,
                chunkBytes = 131_072,
            )
        }.exceptionOrNull()

        assertEquals("media_trop_gros", error?.message)
    }

    @Test
    fun streamMetadataRejectsMoreThanFourThousandAndNinetySixChunks() {
        val error = runCatching {
            MediaChunker.encodeMeta(
                mediaId = "too-many-chunks",
                mime = "image/jpeg",
                sizeBytes = 4_097,
                sha256 = "a".repeat(64),
                chunkCount = 4_097,
                chunkBytes = 1,
            )
        }.exceptionOrNull()

        assertEquals("media_chunk_count_invalide", error?.message)
    }
}
