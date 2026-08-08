package fr.mina.gateway.chat

import com.google.firebase.auth.FirebaseAuth

/**
 * Lit seulement une session Firebase déjà établie : ce composant ne déclenche ni Auth,
 * ni App Check, ni enregistrement FCM. Sans claims appareil exacts, le réveil est refusé.
 */
object FirebaseFcmSession {
    fun resolve(expectedDeviceId: String, onResolved: (FcmSyncTarget?) -> Unit) {
        val user = runCatching { FirebaseAuth.getInstance().currentUser }.getOrNull()
            ?: return onResolved(null)
        user.getIdToken(false)
            .addOnSuccessListener { result -> onResolved(FcmSyncTarget.fromClaims(result.claims, expectedDeviceId)) }
            .addOnFailureListener { onResolved(null) }
    }
}
