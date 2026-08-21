package fr.mina.gateway.telephony

import android.content.Intent
import android.telecom.Call
import android.telecom.InCallService
import android.telecom.VideoProfile

/**
 * InCallService de Mina (SPEC-MINA-COMMS-001 §8, Phase 5). Reçoit les appels du framework Telecom quand
 * Mina tient le rôle dialer ([DialerRoleRequest]). Publie un instantané NON sensible à un listener injecté
 * et présente l'écran d'appel ([MinaInCallActivity]). **Phase 5 = CONTRÔLE Android seulement, MÉDIA
 * DÉSACTIVÉ** (porte Phase 5) : aucun pont audio n'est établi ici — le média HFP est Phase 6, gaté par la
 * porte §6. **Aucun décrochage automatique** : `onCallAdded` OBSERVE et affiche ; toute action
 * (`answer`/`reject`/`hangUp`) est décidée en amont par [IncomingCallPolicy] et déclenchée explicitement.
 */
class MinaInCallService : InCallService() {

    /** Écouteur injecté par l'app pour publier les événements signés (Phase 5). Null = aucun effet. */
    var listener: CallEventListener? = null

    override fun onCallAdded(call: Call) {
        activeCall = call
        listener?.onCallDetected(CallSnapshot.from(call))
        // Écran d'appel (Mina est l'app téléphone active). OBSERVATION : jamais d'auto-answer, média désactivé.
        runCatching {
            startActivity(Intent(this, MinaInCallActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }

    override fun onCallRemoved(call: Call) {
        if (activeCall === call) activeCall = null
        listener?.onCallEnded(CallSnapshot.from(call))
    }

    // Contrôle Telecom (média désactivé) — appelé seulement après une décision d'éligibilité explicite.
    fun answer(call: Call) = call.answer(VideoProfile.STATE_AUDIO_ONLY)
    fun reject(call: Call) = call.reject(false, null)
    fun hangUp(call: Call) = call.disconnect()

    companion object {
        // Appel courant, exposé à l'écran d'appel. Volatile : lu depuis le thread UI de l'activité.
        @JvmStatic
        @Volatile
        var activeCall: Call? = null
    }
}

/** Publication des événements d'appel signés vers l'app (implémenté côté app, Phase 5). */
interface CallEventListener {
    fun onCallDetected(snapshot: CallSnapshot)
    fun onCallEnded(snapshot: CallSnapshot)
}
