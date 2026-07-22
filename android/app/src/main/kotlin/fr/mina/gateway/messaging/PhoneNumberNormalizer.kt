package fr.mina.gateway.messaging

import android.telephony.PhoneNumberUtils
import java.util.Locale

object PhoneNumberNormalizer {
    fun toE164(number: String, region: String = Locale.getDefault().country): String? {
        val trimmed = number.trim()
        if (trimmed.matches(Regex("^\\+[1-9][0-9]{7,14}$"))) return trimmed
        val normalizedRegion = region.trim().uppercase(Locale.ROOT)
        if (!normalizedRegion.matches(Regex("^[A-Z]{2}$"))) return null
        return PhoneNumberUtils.formatNumberToE164(trimmed, normalizedRegion)
            ?.takeIf { it.matches(Regex("^\\+[1-9][0-9]{7,14}$")) }
    }
}
