package fr.mina.gateway.telephony

import android.telecom.Call

/**
 * Instantané NON sensible d'un appel Telecom, destiné à publier un événement signé (§8.4, §16).
 * Ne conserve JAMAIS d'audio ; le numéro complet est masqué (indicatif + 4 derniers chiffres). La
 * fonction [mask] est PURE et testée ; [from] lit le framework Telecom (compile, non testé en unité).
 */
data class CallSnapshot(
    val stateCode: Int,
    val maskedNumber: String,
    val direction: String,
) {
    companion object {
        fun from(call: Call): CallSnapshot {
            val details = call.details
            val raw = details?.handle?.schemeSpecificPart
            val direction = if (details?.callDirection == Call.Details.DIRECTION_OUTGOING) "outbound" else "inbound"
            return CallSnapshot(call.state, mask(raw), direction)
        }

        fun mask(number: String?): String {
            val digits = (number ?: "").filter { it.isDigit() || it == '+' }
            if (digits.length < 6) return if (digits.isEmpty()) "inconnu" else digits
            return digits.take(4) + "••••" + digits.takeLast(4)
        }
    }
}
