package fr.mina.gateway.camera

import android.Manifest
import android.app.KeyguardManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.os.IBinder
import android.util.Size
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import fr.mina.gateway.transport.DeviceIdentityStore
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

class CameraStreamGuard(
    startedAtMs: Long,
    private val frameIntervalMs: Long = 200,
    private val transportTimeoutMs: Long = 10_000,
) {
    private var lastEncodedAtMs = startedAtMs - frameIntervalMs
    private var lastTransportAtMs = startedAtMs

    @Synchronized
    fun shouldEncode(nowMs: Long): Boolean {
        if (nowMs - lastEncodedAtMs < frameIntervalMs) return false
        lastEncodedAtMs = nowMs
        return true
    }

    @Synchronized
    fun transportSeen(nowMs: Long) {
        if (nowMs > lastTransportAtMs) lastTransportAtMs = nowMs
    }

    @Synchronized
    fun transportExpired(nowMs: Long): Boolean = nowMs - lastTransportAtMs > transportTimeoutMs
}

class CameraStreamService : Service(), LifecycleOwner {
    private val lifecycleRegistry = LifecycleRegistry(this)
    override fun getLifecycle(): Lifecycle = lifecycleRegistry
    private val analyzerExecutor = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "mina-camera-analyzer").apply { isDaemon = true }
    }
    private val sequence = AtomicLong(0)
    private val screenOffReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == Intent.ACTION_SCREEN_OFF) stopSelf()
        }
    }
    private var cameraProvider: ProcessCameraProvider? = null
    private var sessionId = ""
    private var lens = CameraLens.FRONT
    private lateinit var guard: CameraStreamGuard
    private lateinit var writer: CameraFrameFileWriter

    override fun onCreate() {
        super.onCreate()
        lifecycleRegistry.handleLifecycleEvent(Lifecycle.Event.ON_CREATE)
        createNotificationChannel()
        registerReceiver(screenOffReceiver, IntentFilter(Intent.ACTION_SCREEN_OFF))
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP || checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            stopSelf()
            return START_NOT_STICKY
        }
        lens = if (intent?.getStringExtra(EXTRA_LENS) == "back") CameraLens.BACK else CameraLens.FRONT
        sessionId = "cam-${UUID.randomUUID().toString().replace("-", "")}" 
        val startedAt = System.currentTimeMillis()
        guard = CameraStreamGuard(startedAt)
        writer = CameraFrameFileWriter(filesDir.resolve(STREAM_DIRECTORY))
        startCameraForeground(notification("Caméra ${lens.name.lowercase()} active"))
        lifecycleRegistry.handleLifecycleEvent(Lifecycle.Event.ON_START)
        startCamera()
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        cameraProvider?.unbindAll()
        analyzerExecutor.shutdownNow()
        if (lifecycleRegistry.currentState.isAtLeast(Lifecycle.State.STARTED)) {
            lifecycleRegistry.handleLifecycleEvent(Lifecycle.Event.ON_STOP)
        }
        lifecycleRegistry.handleLifecycleEvent(Lifecycle.Event.ON_DESTROY)
        unregisterReceiver(screenOffReceiver)
        if (::writer.isInitialized) writer.clear()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun startCamera() {
        val providerFuture = ProcessCameraProvider.getInstance(this)
        providerFuture.addListener({
            if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED || isDeviceLocked()) {
                stopSelf()
                return@addListener
            }
            try {
                val provider = providerFuture.get(5, TimeUnit.SECONDS)
                cameraProvider = provider
                val analysis = ImageAnalysis.Builder()
                    .setTargetResolution(Size(TARGET_WIDTH, TARGET_HEIGHT))
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
                    .build()
                analysis.setAnalyzer(analyzerExecutor, ::analyze)
                val selector = if (lens == CameraLens.BACK) CameraSelector.DEFAULT_BACK_CAMERA else CameraSelector.DEFAULT_FRONT_CAMERA
                provider.unbindAll()
                provider.bindToLifecycle(this, selector, analysis)
            } catch (_: Exception) {
                stopSelf()
            }
        }, mainExecutor)
    }

    private fun analyze(image: ImageProxy) {
        try {
            val now = System.currentTimeMillis()
            val keepalive = writer.transportKeepaliveMs()
            if (keepalive != null) guard.transportSeen(keepalive)
            if (guard.transportExpired(now) || isDeviceLocked()
                || checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED
            ) {
                stopSelf()
                return
            }
            if (!guard.shouldEncode(now)) return
            val jpeg = rgbaToJpeg(image)
            val identity = DeviceIdentityStore(this)
            val encoder = CameraFrameEncoder { challenge ->
                identity.createProof(challenge).let { proof ->
                    CameraFrameProof(proof.deviceId, proof.publicKeySpkiBase64, proof.challenge, proof.signatureBase64)
                }
            }
            val frame = encoder.encode(
                sessionId = sessionId,
                sequence = sequence.incrementAndGet(),
                capturedAtMs = now,
                lens = lens,
                rotation = image.imageInfo.rotationDegrees,
                width = image.width,
                height = image.height,
                jpeg = jpeg,
            )
            writer.publish(frame)
        } catch (_: IllegalArgumentException) {
            // Une image trop grande ou malformée est supprimée, jamais mise en attente.
        } finally {
            image.close()
        }
    }

    private fun rgbaToJpeg(image: ImageProxy): ByteArray {
        val plane = image.planes.single()
        val buffer = plane.buffer
        buffer.rewind()
        val paddedWidth = plane.rowStride / plane.pixelStride
        require(plane.pixelStride == 4 && paddedWidth >= image.width) { "unsupported_rgba_layout" }
        val padded = Bitmap.createBitmap(paddedWidth, image.height, Bitmap.Config.ARGB_8888)
        padded.copyPixelsFromBuffer(buffer)
        val bitmap = if (paddedWidth == image.width) padded else Bitmap.createBitmap(padded, 0, 0, image.width, image.height)
        return try {
            ByteArrayOutputStream(128 * 1024).use { output ->
                check(bitmap.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, output)) { "jpeg_encode_failed" }
                output.toByteArray()
            }
        } finally {
            if (bitmap !== padded) bitmap.recycle()
            padded.recycle()
        }
    }

    private fun isDeviceLocked(): Boolean = getSystemService(KeyguardManager::class.java).isDeviceLocked

    private fun startCameraForeground(value: Notification) {
        if (android.os.Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIFICATION_ID, value, ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA)
        } else {
            startForeground(NOTIFICATION_ID, value)
        }
    }

    private fun notification(text: String): Notification {
        val stop = PendingIntent.getService(
            this,
            0,
            Intent(this, CameraStreamService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_camera)
            .setContentTitle("Mina Vision")
            .setContentText(text)
            .setOngoing(true)
            .addAction(Notification.Action.Builder(null, "Arrêter la caméra", stop).build())
            .build()
    }

    private fun createNotificationChannel() {
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "Caméra Mina Vision", NotificationManager.IMPORTANCE_LOW),
        )
    }

    companion object {
        const val ACTION_START = "fr.mina.gateway.camera.START"
        const val ACTION_STOP = "fr.mina.gateway.camera.STOP"
        const val EXTRA_LENS = "lens"
        const val STREAM_DIRECTORY = "camera-stream"
        private const val CHANNEL_ID = "mina_camera"
        private const val NOTIFICATION_ID = 42
        private const val TARGET_WIDTH = 640
        private const val TARGET_HEIGHT = 480
        private const val JPEG_QUALITY = 75
    }
}

class CameraFrameFileWriter(private val directory: File) {
    init { check(directory.mkdirs() || directory.isDirectory) { "camera_stream_directory_unavailable" } }

    fun transportKeepaliveMs(): Long? = directory.resolve(KEEPALIVE_FILE)
        .takeIf(File::isFile)
        ?.lastModified()

    @Synchronized
    fun publish(frame: EncodedCameraFrame) {
        val stem = "frame-${frame.metadata.sequence}"
        val jpegFile = directory.resolve("$stem.jpg")
        val jpegTemporary = directory.resolve("$stem.jpg.tmp")
        jpegTemporary.writeBytes(frame.jpeg)
        check(jpegTemporary.renameTo(jpegFile)) { "camera_jpeg_commit_failed" }

        val envelope = JSONObject().apply {
            put("version", 1)
            put("file", jpegFile.name)
            put("sessionId", frame.metadata.sessionId)
            put("sequence", frame.metadata.sequence)
            put("capturedAtMs", frame.metadata.capturedAtMs)
            put("lens", frame.metadata.lens.name.lowercase())
            put("rotation", frame.metadata.rotation)
            put("width", frame.metadata.width)
            put("height", frame.metadata.height)
            put("mimeType", frame.metadata.mimeType)
            put("jpegQuality", frame.metadata.jpegQuality)
            put("sha256", frame.metadata.sha256)
            put("deviceId", frame.proof.deviceId)
            put("publicKeySpkiBase64", frame.proof.publicKeySpkiBase64)
            put("challenge", frame.proof.challenge)
            put("signatureBase64", frame.proof.signatureBase64)
        }.toString()
        val latestTemporary = directory.resolve("latest.json.tmp")
        latestTemporary.writeText(envelope, StandardCharsets.UTF_8)
        val latest = directory.resolve("latest.json")
        if (latest.exists()) check(latest.delete()) { "camera_latest_replace_failed" }
        check(latestTemporary.renameTo(latest)) { "camera_latest_commit_failed" }
        val oldestRetainedSequence = frame.metadata.sequence - RETAINED_FRAME_COUNT + 1
        directory.listFiles { file ->
            val storedSequence = FRAME_FILE.matchEntire(file.name)?.groupValues?.get(1)?.toLongOrNull()
            storedSequence != null && storedSequence < oldestRetainedSequence
        }?.forEach(File::delete)
    }

    fun clear() {
        directory.listFiles()?.forEach(File::delete)
    }

    private companion object {
        const val KEEPALIVE_FILE = "transport.keepalive"
        const val RETAINED_FRAME_COUNT = 10
        val FRAME_FILE = Regex("^frame-([0-9]+)\\.jpg$")
    }
}
