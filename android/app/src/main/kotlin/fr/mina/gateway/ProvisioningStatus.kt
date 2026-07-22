package fr.mina.gateway

data class ProvisioningState(
    val smsPermissionGranted: Boolean,
    val hasOwnerIdentity: Boolean,
    val hasTelegramToken: Boolean,
)

fun shouldReplaceTelegramToken(providedTokenLength: Int, hasStoredToken: Boolean): Boolean {
    require(providedTokenLength >= 0) { "telegram_token_length_invalid" }
    require(providedTokenLength > 0 || hasStoredToken) { "telegram_token_missing" }
    return providedTokenLength > 0
}

fun provisioningStatusText(state: ProvisioningState): String {
    val sms = if (state.smsPermissionGranted) "autorisé" else "permission requise"
    val telegram = when {
        state.hasOwnerIdentity && state.hasTelegramToken -> "configuré, service démarré"
        state.hasOwnerIdentity -> "identité enregistrée, token manquant"
        else -> "non configuré"
    }
    return "SMS : $sms\nTelegram : $telegram"
}
