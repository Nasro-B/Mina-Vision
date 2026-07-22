package fr.mina.gateway.camera

import java.security.MessageDigest

data class CameraFrameProof(
    val deviceId: String,
    val publicKeySpkiBase64: String,
    val challenge: String,
    val signatureBase64: String,
)

fun interface CameraFrameSigner {
    fun sign(challenge: String): CameraFrameProof
}

data class CameraFrameMetadata(
    val sessionId: String,
    val sequence: Long,
    val capturedAtMs: Long,
    val lens: CameraLens,
    val rotation: Int,
    val width: Int,
    val height: Int,
    val mimeType: String,
    val jpegQuality: Int,
    val sha256: String,
) {
    fun signingChallenge(): String = listOf(
        "mina-camera-frame-v1",
        sessionId,
        sequence,
        capturedAtMs,
        lens.name,
        rotation,
        width,
        height,
        mimeType,
        jpegQuality,
        sha256,
    ).joinToString("|")
}

data class EncodedCameraFrame(
    val metadata: CameraFrameMetadata,
    val proof: CameraFrameProof,
    val jpeg: ByteArray,
)

class CameraFrameEncoder(private val signer: CameraFrameSigner) {
    fun encode(
        sessionId: String,
        sequence: Long,
        capturedAtMs: Long,
        lens: CameraLens,
        rotation: Int,
        width: Int,
        height: Int,
        jpeg: ByteArray,
    ): EncodedCameraFrame {
        require(SESSION_ID.matches(sessionId)) { "invalid_session_id" }
        require(sequence > 0) { "invalid_sequence" }
        require(capturedAtMs > 0) { "invalid_capture_time" }
        require(rotation in VALID_ROTATIONS) { "invalid_rotation" }
        require(width in 1..MAX_DIMENSION && height in 1..MAX_DIMENSION) { "invalid_dimensions" }
        require(jpeg.size in MIN_JPEG_BYTES..MAX_JPEG_BYTES) { "invalid_jpeg_size" }
        require(jpeg[0] == JPEG_MAGIC_0 && jpeg[1] == JPEG_MAGIC_1 && jpeg[2] == JPEG_MAGIC_2) { "invalid_jpeg" }

        val immutableJpeg = jpeg.copyOf()
        val metadata = CameraFrameMetadata(
            sessionId = sessionId,
            sequence = sequence,
            capturedAtMs = capturedAtMs,
            lens = lens,
            rotation = rotation,
            width = width,
            height = height,
            mimeType = "image/jpeg",
            jpegQuality = JPEG_QUALITY,
            sha256 = MessageDigest.getInstance("SHA-256")
                .digest(immutableJpeg)
                .joinToString("") { "%02x".format(it) },
        )
        val challenge = metadata.signingChallenge()
        val proof = signer.sign(challenge)
        require(proof.challenge == challenge) { "invalid_frame_proof_challenge" }
        require(proof.deviceId.isNotBlank()) { "invalid_frame_proof_device" }
        require(proof.publicKeySpkiBase64.isNotBlank()) { "invalid_frame_proof_key" }
        require(proof.signatureBase64.isNotBlank()) { "invalid_frame_proof_signature" }
        return EncodedCameraFrame(metadata, proof, immutableJpeg)
    }

    private companion object {
        val SESSION_ID = Regex("^cam-[a-f0-9]{32}$")
        val VALID_ROTATIONS = setOf(0, 90, 180, 270)
        const val MAX_DIMENSION = 4096
        const val MIN_JPEG_BYTES = 4
        const val MAX_JPEG_BYTES = 350 * 1024
        const val JPEG_QUALITY = 75
        val JPEG_MAGIC_0 = 0xff.toByte()
        val JPEG_MAGIC_1 = 0xd8.toByte()
        val JPEG_MAGIC_2 = 0xff.toByte()
    }
}

class LatestCameraFrameBuffer {
    private var latest: EncodedCameraFrame? = null
    private var dropped = 0L

    @Synchronized
    fun offer(frame: EncodedCameraFrame) {
        if (latest != null) dropped += 1
        latest = frame
    }

    @Synchronized
    fun takeLatest(): EncodedCameraFrame? = latest.also { latest = null }

    @Synchronized
    fun droppedCount(): Long = dropped
}
