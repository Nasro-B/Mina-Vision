package fr.mina.gateway.telephony

import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.telecom.VideoProfile
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Écran d'appel minimal de Mina (SPEC-MINA-COMMS-001 §8, Phase 5). Requis parce qu'une app tenant le rôle
 * dialer DOIT fournir une UI d'appel (sinon l'écran d'appel du téléphone serait cassé). Vues construites en
 * code (aucun fichier de ressources) pour garder le module isolé. Le numéro affiché est MASQUÉ (§16).
 * MÉDIA DÉSACTIVÉ (Phase 5) : « Répondre » ne fait qu'accepter l'appel côté Telecom, aucun pont audio ici.
 */
class MinaInCallActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val call = MinaInCallService.activeCall
        val masked = CallSnapshot.mask(call?.details?.handle?.schemeSpecificPart)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#0B0B0F"))
            setPadding(64, 128, 64, 128)
        }
        fun label(text: String, size: Float, color: Int) = TextView(this).apply {
            this.text = text; textSize = size; setTextColor(color); gravity = Gravity.CENTER
        }
        root.addView(label("Mina Vision", 16f, Color.parseColor("#8B8B93")))
        root.addView(label("Appel entrant", 26f, Color.WHITE))
        root.addView(label(masked, 20f, Color.parseColor("#C7C7CC")))

        val answer = Button(this).apply {
            text = "Répondre"
            setOnClickListener { MinaInCallService.activeCall?.answer(VideoProfile.STATE_AUDIO_ONLY) }
        }
        val hangUp = Button(this).apply {
            text = "Raccrocher"
            setOnClickListener { MinaInCallService.activeCall?.disconnect(); finish() }
        }
        root.addView(answer, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        root.addView(hangUp, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        setContentView(root)
    }
}
