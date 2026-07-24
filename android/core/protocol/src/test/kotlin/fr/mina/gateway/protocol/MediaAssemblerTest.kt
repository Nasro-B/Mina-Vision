package fr.mina.gateway.protocol

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test
import java.security.MessageDigest
import kotlin.random.Random

/** Miroir du réassembleur Node (media-assembler.mjs) : mêmes bornes, même rejet total. */
class MediaAssemblerTest {
    private fun sha256Hex(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    private fun metaOf(bytes: ByteArray, chunkBytes: Int = 131_072) = mapOf(
        "mediaId" to "abc123",
        "mime" to "image/jpeg",
        "sizeBytes" to bytes.size,
        "sha256" to sha256Hex(bytes),
        "chunkCount" to (bytes.size + chunkBytes - 1) / chunkBytes,
        "chunkBytes" to chunkBytes,
    )

    @Test
    fun `round-trip 2 chunks - octets identiques`() {
        val bytes = Random(7).nextBytes(200_000)
        val meta = MediaAssembler.parseMeta(metaOf(bytes))
        val chunks = (0 until meta.chunkCount).associateWith { index ->
            bytes.copyOfRange(index * meta.chunkBytes, minOf((index + 1) * meta.chunkBytes, bytes.size))
        }
        assertArrayEquals(bytes, MediaAssembler.assemble(meta, chunks))
    }

    @Test
    fun `digest divergent - rejet TOTAL, jamais un media presque bon`() {
        val bytes = Random(8).nextBytes(1_000)
        val meta = MediaAssembler.parseMeta(metaOf(bytes))
        val corrupted = bytes.copyOf().also { it[500] = (it[500] + 1).toByte() }
        val error = runCatching { MediaAssembler.assemble(meta, mapOf(0 to corrupted)) }.exceptionOrNull()
        assertEquals("media_digest_divergent", error?.message)
    }

    @Test
    fun `chunk manquant ou taille fausse - rejet`() {
        val bytes = Random(9).nextBytes(200_000)
        val meta = MediaAssembler.parseMeta(metaOf(bytes))
        assertEquals(
            "media_chunk_manquant:1",
            runCatching { MediaAssembler.assemble(meta, mapOf(0 to bytes.copyOfRange(0, 131_072))) }.exceptionOrNull()?.message,
        )
        assertEquals(
            "media_chunk_taille_invalide:0",
            runCatching { MediaAssembler.assemble(meta, mapOf(0 to ByteArray(10), 1 to ByteArray(10))) }.exceptionOrNull()?.message,
        )
    }

    @Test
    fun `meta invalide - mime refuse, taille hors borne, count incoherent`() {
        val bytes = Random(10).nextBytes(100)
        assertEquals("media_mime_refuse:application/exe", runCatching {
            MediaAssembler.parseMeta(metaOf(bytes).plus("mime" to "application/exe"))
        }.exceptionOrNull()?.message)
        assertEquals("media_taille_invalide", runCatching {
            MediaAssembler.parseMeta(metaOf(bytes).plus("sizeBytes" to 6 * 1024 * 1024))
        }.exceptionOrNull()?.message)
        assertEquals("media_chunk_count_invalide", runCatching {
            MediaAssembler.parseMeta(metaOf(bytes).plus("chunkCount" to 99))
        }.exceptionOrNull()?.message)
    }
}
