package fr.mina.gateway.feature.chat

import android.content.Context
import android.media.MediaRecorder
import android.os.Build
import java.io.File

/**
 * Enregistre une note vocale courte en m4a (conteneur MPEG-4 + codec AAC → mime `audio/mp4`, accepté
 * tel quel par le PC via MediaChunker). Le fichier vit dans le cache de l'app le temps de la lecture,
 * puis est SUPPRIMÉ : aucune capture audio ne traîne en clair sur le disque du téléphone. Durée bornée
 * (anti-oubli d'un micro ouvert), taille bornée à 5 Mo comme les images.
 *
 * Distinct de VoiceDictation : la dictée transforme la voix en TEXTE via le moteur du téléphone ;
 * ici on envoie l'AUDIO lui-même, chiffré comme toute pièce jointe. Mina le transcrira côté PC si la
 * transcription locale est activée, sinon elle le gardera et le dira honnêtement.
 */
class VoiceNoteRecorder(private val context: Context) {
    private var recorder: MediaRecorder? = null
    private var outputFile: File? = null
    private var startedAtMs: Long = 0L

    val isRecording: Boolean get() = recorder != null

    /** Démarre l'enregistrement. Lève si le micro est indisponible — jamais un faux « ça enregistre ». */
    fun start() {
        stopQuietly()
        val file = File.createTempFile("mina-voice-", ".m4a", context.cacheDir)
        val rec = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            MediaRecorder(context)
        } else {
            @Suppress("DEPRECATION") MediaRecorder()
        }
        rec.setAudioSource(MediaRecorder.AudioSource.MIC)
        rec.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
        rec.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
        rec.setAudioEncodingBitRate(64_000)
        rec.setAudioSamplingRate(44_100)
        rec.setMaxDuration(MAX_DURATION_MS)
        rec.setOutputFile(file.absolutePath)
        rec.prepare()
        rec.start()
        recorder = rec
        outputFile = file
        startedAtMs = System.currentTimeMillis()
    }

    /**
     * Arrête et retourne les octets m4a, ou null si trop court/vide/échec (MediaRecorder.stop() lève
     * quand rien de valide n'a été capté). Le fichier temporaire est toujours nettoyé.
     */
    fun stop(): ByteArray? {
        val rec = recorder ?: return null
        val file = outputFile
        val elapsed = System.currentTimeMillis() - startedAtMs
        recorder = null
        outputFile = null
        return try {
            rec.stop()
            if (elapsed < MIN_DURATION_MS || file == null || !file.exists()) return null
            val bytes = file.readBytes()
            if (bytes.isEmpty() || bytes.size > MAX_BYTES) null else bytes
        } catch (t: Throwable) {
            null
        } finally {
            runCatching { rec.release() }
            file?.delete()
        }
    }

    /** Annule sans rien renvoyer (écran quitté, permission refusée après coup). */
    fun cancel() = stopQuietly()

    private fun stopQuietly() {
        val rec = recorder
        val file = outputFile
        recorder = null
        outputFile = null
        if (rec != null) {
            runCatching { rec.stop() }
            runCatching { rec.release() }
        }
        file?.delete()
    }

    companion object {
        private const val MIN_DURATION_MS = 500L
        private const val MAX_DURATION_MS = 120_000
        private const val MAX_BYTES = 5 * 1024 * 1024
    }
}
