package fr.mina.gateway.telephony

/**
 * Politique d'éligibilité d'un appel entrant (SPEC-MINA-COMMS-001 §7, §9, §11, §19). Décision PURE,
 * miroir Kotlin de `src/telephony/incoming-call-policy.mjs`. Mina ne décroche QUE si toutes les
 * conditions matérielles/logicielles sont vraies (§7) ET si l'appel passe la politique (numéro,
 * horaires, concurrence, niveau). Urgence / numéro court TOUJOURS refusé. Un seul appel Mina actif
 * (§11). Aucun niveau ne s'active automatiquement. Un contenu externe ne rend jamais un appel
 * éligible. Cette classe DÉCIDE ; elle ne décroche pas et ne touche aucun média.
 */
object IncomingCallPolicy {
    val READINESS_CONDITIONS: List<String> = listOf(
        "signed_identity", "adb_endpoint", "mina_channel", "phone_role", "hfp_endpoint",
        "rx_capture", "tx_injection", "stt", "dialogue", "tts", "call_policy",
        "emergency_stop_clear", "no_other_session",
    )

    /** Niveaux de déploiement (§19). Aucun ne s'active automatiquement. */
    val DEPLOYMENT_LEVELS: List<String> = listOf("observe", "assisted", "pilot", "dual", "unknown_numbers")

    private val EMERGENCY_NUMBERS: Set<String> =
        setOf("15", "17", "18", "112", "114", "115", "116", "119", "191", "196", "197")

    data class Readiness(val ready: Boolean, val missing: List<String>)
    data class Decision(val eligible: Boolean, val reason: String?)
    data class BusinessHours(val startHour: Int, val endHour: Int)

    fun evaluateReadiness(state: Map<String, Boolean>): Readiness {
        val missing = READINESS_CONDITIONS.filter { state[it] != true }
        return Readiness(missing.isEmpty(), missing)
    }

    private fun isEmergencyOrShort(number: String?): Boolean {
        val digits = (number ?: "").filter { it.isDigit() }
        if (digits.isEmpty()) return true // masqué / inconnu → prudence
        if (digits in EMERGENCY_NUMBERS) return true
        return digits.length < 6 // numéros courts / premium
    }

    // Heure de référence dérivée de atMs en UTC : l'appelant fournit un atMs déjà ajusté au fuseau
    // local s'il veut des horaires locaux (garde la décision pure et testable de façon déterministe).
    private fun withinHours(atMs: Long, hours: BusinessHours?): Boolean {
        if (hours == null) return true
        val hour = (((atMs / 3_600_000L) % 24L + 24L) % 24L).toInt()
        return hour >= hours.startHour && hour < hours.endHour
    }

    fun evaluateIncomingCall(
        readiness: Readiness?,
        numberE164: String? = null,
        atMs: Long = 0,
        activeMinaCalls: Int = 0,
        level: String = "observe",
        knownContacts: List<String> = emptyList(),
        businessHours: BusinessHours? = null,
        blockedNumbers: List<String> = emptyList(),
    ): Decision {
        // Niveau 0 observation : on ne décroche JAMAIS (§19 niveau 0).
        if (level == "observe") return Decision(false, "observation_only")
        if (level !in DEPLOYMENT_LEVELS) return Decision(false, "level_unknown")

        val state = readiness ?: evaluateReadiness(emptyMap())
        if (!state.ready) return Decision(false, "not_ready:${state.missing.firstOrNull() ?: "unknown"}")

        if (activeMinaCalls >= 1) return Decision(false, "concurrent_call") // §11 : un seul appel actif
        if (numberE164 in blockedNumbers) return Decision(false, "blocked_number")
        if (isEmergencyOrShort(numberE164)) return Decision(false, "emergency_or_short")

        // Pilote (§19 niveau 2/3) : contacts connus + horaires ouvrés seulement.
        if ((level == "pilot" || level == "dual") && knownContacts.isNotEmpty() && numberE164 !in knownContacts) {
            return Decision(false, "unknown_number")
        }
        if ((level == "pilot" || level == "dual") && businessHours != null && !withinHours(atMs, businessHours)) {
            return Decision(false, "outside_hours")
        }
        return Decision(true, null)
    }
}
