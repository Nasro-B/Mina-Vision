package fr.mina.gateway.camera

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Files

class CameraFrameEncoderTest {
    private val jpeg = byteArrayOf(0xff.toByte(), 0xd8.toByte(), 0xff.toByte(), 1, 2, 0xff.toByte(), 0xd9.toByte())

    @Test
    fun createsBoundedSignedMetadataForAFrame() {
        val signer = CameraFrameSigner { challenge ->
            CameraFrameProof("device-huawei", "public-key", challenge, "signature")
        }
        val frame = CameraFrameEncoder(signer).encode(
            sessionId = "cam-0123456789abcdef0123456789abcdef",
            sequence = 7,
            capturedAtMs = 2_000,
            lens = CameraLens.FRONT,
            rotation = 90,
            width = 640,
            height = 480,
            jpeg = jpeg,
        )

        assertEquals(7L, frame.metadata.sequence)
        assertEquals("image/jpeg", frame.metadata.mimeType)
        assertEquals(75, frame.metadata.jpegQuality)
        assertTrue(frame.metadata.sha256.matches(Regex("^[a-f0-9]{64}$")))
        assertEquals(frame.proof.challenge, frame.metadata.signingChallenge())
        assertEquals(jpeg.toList(), frame.jpeg.toList())
    }

    @Test
    fun rejectsOversizedMalformedOrInvalidlyRotatedFrames() {
        val encoder = CameraFrameEncoder(CameraFrameSigner { error("must_not_sign") })
        assertThrows(IllegalArgumentException::class.java) {
            encoder.encode("cam-0123456789abcdef0123456789abcdef", 1, 1, CameraLens.BACK, 45, 640, 480, jpeg)
        }
        assertThrows(IllegalArgumentException::class.java) {
            encoder.encode("cam-0123456789abcdef0123456789abcdef", 1, 1, CameraLens.BACK, 0, 640, 480, ByteArray(350 * 1024 + 1))
        }
    }

    @Test
    fun latestFrameBufferDropsStaleFramesInsteadOfQueueingThem() {
        val buffer = LatestCameraFrameBuffer()
        buffer.offer(frame(1))
        buffer.offer(frame(2))
        buffer.offer(frame(3))

        assertEquals(3L, buffer.takeLatest()?.metadata?.sequence)
        assertEquals(2L, buffer.droppedCount())
        assertNull(buffer.takeLatest())
    }

    @Test
    fun streamGuardBoundsRateAndStopsAfterTransportLoss() {
        val guard = CameraStreamGuard(startedAtMs = 1_000)

        assertTrue(guard.shouldEncode(1_000))
        assertTrue(!guard.shouldEncode(1_199))
        assertTrue(guard.shouldEncode(1_200))
        guard.transportSeen(2_000)
        assertTrue(!guard.transportExpired(11_999))
        assertTrue(guard.transportExpired(12_001))
    }

    @Test
    fun fileWriterRetainsOnlyTenRecentFramesForRaceSafeReads() {
        val directory = Files.createTempDirectory("mina-camera-test").toFile()
        try {
            val writer = CameraFrameFileWriter(directory)
            (1L..12L).forEach { writer.publish(frame(it)) }
            val sequences = directory.listFiles { file -> file.name.matches(Regex("^frame-[0-9]+\\.jpg$")) }
                .orEmpty()
                .map { it.name.removePrefix("frame-").removeSuffix(".jpg").toLong() }
                .sorted()
            assertEquals((3L..12L).toList(), sequences)
        } finally {
            directory.deleteRecursively()
        }
    }

    private fun frame(sequence: Long): EncodedCameraFrame = CameraFrameEncoder(
        CameraFrameSigner { challenge -> CameraFrameProof("device-huawei", "key", challenge, "signature") },
    ).encode("cam-0123456789abcdef0123456789abcdef", sequence, 2_000, CameraLens.BACK, 0, 640, 480, jpeg)
}
