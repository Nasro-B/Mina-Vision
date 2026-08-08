package fr.mina.gateway.chat

import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import java.nio.file.Files
import java.security.SecureRandom

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class EncryptedAttachmentStoreTest {
    private lateinit var root: File
    private lateinit var store: EncryptedAttachmentStore
    private val epochKey = ByteArray(32).also { SecureRandom().nextBytes(it) }

    @Before
    fun setUp() {
        root = Files.createTempDirectory("mina-attachments-test-").toFile()
        store = EncryptedAttachmentStore(
            root = root,
            epochKeyProvider = { epoch -> if (epoch == 1) epochKey.copyOf() else null },
            currentEpoch = { 1 },
        )
    }

    @After
    fun tearDown() {
        root.deleteRecursively()
    }

    @Test
    fun `append persists ciphertext only and clears caller buffer`() = runTest {
        val input = "secret-voice".encodeToByteArray()
        val capture = store.createVoiceCapture("thread-main")

        capture.append(input, input.size)

        assertArrayEquals(ByteArray(input.size), input)
        assertFalse(root.walkTopDown().any { it.extension in setOf("pcm", "wav", "m4a", "mp4") })
        val persistedFiles = root.walkTopDown().filter { it.isFile }.toList()
        assertFalse(persistedFiles.any { it.readBytes().containsSlice("secret-voice".encodeToByteArray()) })
        assertFalse(persistedFiles.any { it.readBytes().containsSlice("thread-main".encodeToByteArray()) })
    }

    @Test
    fun `cancel deletes manifest and encrypted chunks`() = runTest {
        val capture = store.createVoiceCapture("thread-main")
        capture.append(ByteArray(32_000) { 7 }, 32_000)

        capture.discard()

        assertEquals(emptyList<File>(), root.listFiles()?.toList() ?: emptyList<File>())
    }

    private fun ByteArray.containsSlice(slice: ByteArray): Boolean {
        if (slice.isEmpty() || slice.size > size) return false
        for (start in 0..size - slice.size) {
            if (slice.indices.all { offset -> this[start + offset] == slice[offset] }) return true
        }
        return false
    }
}
