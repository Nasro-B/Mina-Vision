package fr.mina.gateway.telephony

import android.telecom.Call
import android.telecom.InCallService
import android.telecom.VideoProfile

/**
 * InCallService de Mina (SPEC-MINA-COMMS-001 §8, Phase 5). Reçoit les appels du framework Telecom et
 * publie un instantané NON sensible à un listener injecté. **Phase 5 = CONTRÔLE Android seulement,
 * MÉDIA DÉSACTIVÉ** (porte Phase 5) : aucun pont audio n'est établi ici — le média HFP est Phase 6 et
 * reste gaté par la porte de faisabilité §6. **Aucun décrochage automatique** : `onCallAdded` ne fait
 * qu'OBSERVER ; toute action (`answer`/`reject`/`hangUp`) est décidée en amont par [IncomingCallPolicy]
 * et déclenchée explicitement par l'app — jamais par ce service seul. Tant que le déploiement est en
 * observation (§19 niveau 0), Mina ne décroche jamais.
 */
class MinaInCallService : InCallService() {

    /** Écouteur injecté par l'app pour publier les événements signés (Phase 5). Null = aucun effet. */
    var listener: CallEventListener? = null

    override fun onCallAdded(call: Call) {
        // OBSERVATION uniquement. Aucune décision de décrochage ici : média désactivé, jamais d'auto-answer.
        listener?.onCallDetected(CallSnapshot.from(call))
    }

    override fun onCallRemoved(call: Call) {
        listener?.onCallEnded(CallSnapshot.from(call))
    }

    // Contrôle Telecom (média désactivé) — exposé pour l'app, appelé seulement après une décision
    // d'éligibilité explicite. `answer` reste AUDIO ONLY : aucune vidéo, aucun média établi ici.
    fun answer(call: Call) = call.answer(VideoProfile.STATE_AUDIO_ONLY)
    fun reject(call: Call) = call.reject(false, null)
    fun hangUp(call: Call) = call.disconnect()
}

/** Publication des événements d'appel signés vers l'app (implémenté côté app, Phase 5). */
interface CallEventListener {
    fun onCallDetected(snapshot: CallSnapshot)
    fun onCallEnded(snapshot: CallSnapshot)
}
