package fr.mina.gateway.messaging

data class SmsPart(val sender: String, val body: String, val sentAtMs: Long)

data class InboundSms(val sender: String, val body: String, val sentAtMs: Long)

object SmsMessageAssembler {
    fun assemble(parts: List<SmsPart>): InboundSms? {
        if (parts.isEmpty() || parts.size > 32) return null
        val sender = parts.first().sender.trim()
        if (sender.isEmpty() || sender.length > 128 || parts.any { it.sender.trim() != sender }) return null
        val body = buildString { parts.forEach { append(it.body) } }
        if (body.isEmpty() || body.length > 4096) return null
        val sentAt = parts.minOf { it.sentAtMs }
        if (sentAt <= 0) return null
        return InboundSms(sender, body, sentAt)
    }
}
