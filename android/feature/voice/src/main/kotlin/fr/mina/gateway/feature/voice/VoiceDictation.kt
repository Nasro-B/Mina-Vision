package fr.mina.gateway.feature.voice

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import java.util.Locale

/** Ce que la dictée peut dire d'elle-même — jamais « ça marche » sans preuve. */
sealed interface DictationState {
    data object Idle : DictationState
    data object Listening : DictationState
    data class Partial(val text: String) : DictationState
    data class Final(val text: String) : DictationState
    data class Failed(val reason: String) : DictationState
}

/**
 * Dictée vocale locale pour composer un message.
 *
 * Elle utilise la reconnaissance vocale du téléphone, pas celle du PC : le message dicté est
 * chiffré comme tout autre message avant de partir. Si aucun moteur n'est disponible sur
 * l'appareil, on le DIT — on n'affiche pas un micro qui ne ferait rien.
 */
class VoiceDictation(private val context: Context) {
    private var recognizer: SpeechRecognizer? = null

    fun isAvailable(): Boolean = SpeechRecognizer.isRecognitionAvailable(context)

    fun start(onState: (DictationState) -> Unit) {
        if (!isAvailable()) {
            onState(DictationState.Failed("Aucune reconnaissance vocale sur cet appareil"))
            return
        }
        stop()
        val speech = SpeechRecognizer.createSpeechRecognizer(context)
        recognizer = speech
        speech.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) = onState(DictationState.Listening)
            override fun onBeginningOfSpeech() = Unit
            override fun onRmsChanged(rmsdB: Float) = Unit
            override fun onBufferReceived(buffer: ByteArray?) = Unit
            override fun onEndOfSpeech() = Unit
            override fun onEvent(eventType: Int, params: Bundle?) = Unit

            override fun onPartialResults(partialResults: Bundle?) {
                firstResult(partialResults)?.let { onState(DictationState.Partial(it)) }
            }

            override fun onResults(results: Bundle?) {
                val text = firstResult(results)
                if (text.isNullOrBlank()) onState(DictationState.Failed("Rien n'a été compris"))
                else onState(DictationState.Final(text))
                stop()
            }

            override fun onError(error: Int) {
                onState(DictationState.Failed(reasonOf(error)))
                stop()
            }
        })
        speech.startListening(
            Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.FRANCE.toLanguageTag())
                .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true),
        )
    }

    fun stop() {
        recognizer?.destroy()
        recognizer = null
    }

    private fun firstResult(bundle: Bundle?): String? =
        bundle?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()

    /** Motif lisible : « erreur 7 » n'aide personne à comprendre quoi faire. */
    private fun reasonOf(error: Int): String = when (error) {
        SpeechRecognizer.ERROR_AUDIO -> "Problème de micro"
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Permission micro refusée"
        SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Réseau indisponible pour la reconnaissance"
        SpeechRecognizer.ERROR_NO_MATCH -> "Rien n'a été compris"
        SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "Aucune parole détectée"
        SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Reconnaissance déjà en cours"
        else -> "Dictée impossible (code $error)"
    }
}
