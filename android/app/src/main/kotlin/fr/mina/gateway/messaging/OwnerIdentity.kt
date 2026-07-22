package fr.mina.gateway.messaging

data class OwnerIdentity(
    val phoneE164: String,
    val telegramUserIds: Set<Long>,
) {
    init {
        require(phoneE164.matches(Regex("^\\+[1-9][0-9]{7,14}$"))) { "owner_phone_invalid" }
        require(telegramUserIds.isNotEmpty() && telegramUserIds.all { it > 0 }) { "owner_telegram_ids_invalid" }
    }

    fun ownsPhone(number: String): Boolean = number == phoneE164
    fun ownsTelegram(userId: Long): Boolean = userId in telegramUserIds
}
