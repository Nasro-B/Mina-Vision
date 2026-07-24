package fr.mina.gateway

import android.content.Context
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity

/**
 * Verrou biométrique de la conversation. La conversation avec Mina est chiffrée de bout en bout ;
 * ce verrou ajoute une barrière LOCALE : sur un téléphone déverrouillé mais prêté, les messages
 * n'apparaissent qu'après l'empreinte/le visage.
 *
 * La DÉCISION (faut-il verrouiller ?) est pure et testable ; le prompt lui-même est du code Android.
 */
object BiometricGate {
    /**
     * Le contenu doit-il rester masqué ? Verrou activé ET l'appareil PEUT s'authentifier ET pas
     * encore déverrouillé cette session. Si aucune biométrie n'est enrôlée (canAuthenticate=false),
     * on N'ENFERME JAMAIS dehors : le verrou est ignoré (le réglage prévient l'utilisateur).
     */
    fun isLocked(lockEnabled: Boolean, canAuthenticate: Boolean, unlocked: Boolean): Boolean =
        lockEnabled && canAuthenticate && !unlocked
}

private const val ALLOWED_AUTHENTICATORS =
    BiometricManager.Authenticators.BIOMETRIC_STRONG or BiometricManager.Authenticators.BIOMETRIC_WEAK

/** L'appareil a-t-il une biométrie utilisable (matériel présent + au moins une empreinte enrôlée) ? */
fun canAuthenticateBiometric(context: Context): Boolean =
    BiometricManager.from(context).canAuthenticate(ALLOWED_AUTHENTICATORS) == BiometricManager.BIOMETRIC_SUCCESS

/** Lance le prompt biométrique. onResult(true) au succès ; onResult(false) sur erreur/annulation. */
fun promptBiometricUnlock(activity: FragmentActivity, onResult: (Boolean) -> Unit) {
    val prompt = BiometricPrompt(
        activity,
        ContextCompat.getMainExecutor(activity),
        object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) = onResult(true)
            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) = onResult(false)
            // onAuthenticationFailed (mauvais doigt) : on ne ferme pas, l'utilisateur réessaie.
        },
    )
    val info = BiometricPrompt.PromptInfo.Builder()
        .setTitle("Conversation Mina")
        .setSubtitle("Déverrouille pour voir tes messages")
        .setNegativeButtonText("Annuler")
        .setAllowedAuthenticators(ALLOWED_AUTHENTICATORS)
        .build()
    prompt.authenticate(info)
}
