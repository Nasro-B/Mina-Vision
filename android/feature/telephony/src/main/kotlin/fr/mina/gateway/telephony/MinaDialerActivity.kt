package fr.mina.gateway.telephony

import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.widget.TextView

/**
 * Activité DIAL minimale (SPEC-MINA-COMMS-001 §7, Phase 5). Android n'accorde le rôle dialer qu'à une app
 * qui déclare un gestionnaire de `android.intent.action.DIAL`. Mina n'est pas un vrai clavier téléphonique :
 * cet écran existe UNIQUEMENT pour qualifier au rôle et rester honnête. Le compte-rendu d'appels vit dans
 * l'app principale ; ici, aucun numéro n'est composé ni exécuté.
 */
class MinaDialerActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val view = TextView(this).apply {
            text = "Mina Vision gère les appels entrants selon sa politique.\nOuvre l'application Mina Vision pour le détail."
            textSize = 18f
            gravity = Gravity.CENTER
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#0B0B0F"))
            setPadding(64, 128, 64, 128)
        }
        setContentView(view)
    }
}
