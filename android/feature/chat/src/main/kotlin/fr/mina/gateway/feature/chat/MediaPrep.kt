package fr.mina.gateway.feature.chat

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import java.io.ByteArrayOutputStream
import kotlin.math.max
import kotlin.math.min

/**
 * Prépare une image à envoyer : décodage borné (anti-bombe de décompression), redimensionnement
 * ≤ 2048 px sur le côté long, ré-encodage JPEG q≈85. Le ré-encodage RETIRE les métadonnées EXIF
 * (dont la position GPS) par construction — une photo envoyée à son propre PC ne doit pas fuiter
 * sa localisation si elle transite par le relais. Refuse au-delà de 5 Mo après compression.
 */
object MediaPrep {
    private const val MAX_DIM = 2048
    private const val MAX_BYTES = 5 * 1024 * 1024
    private const val JPEG_QUALITY = 85

    data class PreparedImage(val bytes: ByteArray, val mime: String, val width: Int, val height: Int) {
        override fun equals(other: Any?): Boolean = this === other
        override fun hashCode(): Int = bytes.contentHashCode()
    }

    fun prepareImage(context: Context, uri: Uri): PreparedImage {
        val resolver = context.contentResolver
        // 1) Bornes d'abord, sans allouer la bitmap complète.
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        resolver.openInputStream(uri).use { BitmapFactory.decodeStream(it, null, bounds) }
        require(bounds.outWidth > 0 && bounds.outHeight > 0) { "image_illisible" }

        // 2) Sous-échantillonnage grossier pour éviter de charger une image géante en mémoire.
        var sample = 1
        while (bounds.outWidth / sample > MAX_DIM * 2 || bounds.outHeight / sample > MAX_DIM * 2) sample *= 2
        val decodeOpts = BitmapFactory.Options().apply { inSampleSize = sample }
        var bitmap = resolver.openInputStream(uri).use { BitmapFactory.decodeStream(it, null, decodeOpts) }
            ?: throw IllegalArgumentException("image_illisible")

        // 3) Mise à l'échelle fine sur le côté long.
        val longest = max(bitmap.width, bitmap.height)
        if (longest > MAX_DIM) {
            val scale = MAX_DIM.toFloat() / longest
            val scaled = Bitmap.createScaledBitmap(bitmap, (bitmap.width * scale).toInt().coerceAtLeast(1), (bitmap.height * scale).toInt().coerceAtLeast(1), true)
            if (scaled !== bitmap) bitmap.recycle()
            bitmap = scaled
        }

        // 4) Ré-encodage JPEG (strip EXIF), qualité décroissante si besoin pour tenir sous 5 Mo.
        var quality = JPEG_QUALITY
        var bytes: ByteArray
        do {
            val out = ByteArrayOutputStream()
            bitmap.compress(Bitmap.CompressFormat.JPEG, quality, out)
            bytes = out.toByteArray()
            quality -= 15
        } while (bytes.size > MAX_BYTES && quality >= 40)
        val width = bitmap.width
        val height = bitmap.height
        bitmap.recycle()
        require(bytes.size <= MAX_BYTES) { "image_trop_grosse" }
        return PreparedImage(bytes, "image/jpeg", width, height)
    }

    fun readAllBytes(context: Context, uri: Uri, maxBytes: Int = MAX_BYTES): ByteArray {
        val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
            ?: throw IllegalArgumentException("fichier_illisible")
        require(bytes.isNotEmpty() && bytes.size <= maxBytes) { "fichier_taille_invalide" }
        return bytes
    }
}
