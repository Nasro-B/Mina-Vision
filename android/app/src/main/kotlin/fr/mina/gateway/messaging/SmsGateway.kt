package fr.mina.gateway.messaging

import java.util.UUID

enum class SmsSendState { DRAFT, AWAITING_CONFIRMATION, ACCEPTED_BY_PROVIDER, FAILED }

data class SmsDraft(
    val draftId: String,
    val sourceMessageId: String,
    val recipientE164: String,
    val text: String,
    val state: SmsSendState = SmsSendState.DRAFT,
    val providerReceipt: String? = null,
)

class SmsGateway(
    private val owner: OwnerIdentity,
    private val providerSend: (SmsDraft) -> String,
) {
    private val drafts = mutableMapOf<String, SmsDraft>()
    private var autoSend = false
    private var autoRecipients = emptySet<String>()

    fun draftReply(sourceMessageId: String, recipientE164: String, text: String): SmsDraft {
        require(sourceMessageId.isNotBlank() && sourceMessageId.length <= 160) { "sms_source_id_invalid" }
        require(recipientE164.matches(Regex("^\\+[1-9][0-9]{7,14}$"))) { "sms_recipient_invalid" }
        require(text.isNotBlank() && text.length <= 1600) { "sms_text_invalid" }
        return SmsDraft("draft-${UUID.randomUUID()}", sourceMessageId, recipientE164, text).also { drafts[it.draftId] = it }
    }

    fun setAutoSend(enabled: Boolean, recipients: Set<String>, locallyConfirmed: Boolean) {
        require(locallyConfirmed) { "sms_auto_send_confirmation_required" }
        require(recipients.all { it.matches(Regex("^\\+[1-9][0-9]{7,14}$")) }) { "sms_auto_send_scope_invalid" }
        autoSend = enabled
        autoRecipients = if (enabled) recipients.toSet() else emptySet()
    }

    fun requestSend(draftId: String): SmsDraft {
        val draft = drafts[draftId] ?: error("sms_draft_unknown")
        if (draft.state == SmsSendState.ACCEPTED_BY_PROVIDER) return draft
        if (autoSend && draft.recipientE164 in autoRecipients) return send(draft)
        return draft.copy(state = SmsSendState.AWAITING_CONFIRMATION).also { drafts[draftId] = it }
    }

    fun confirmSend(draftId: String): SmsDraft {
        val draft = drafts[draftId] ?: error("sms_draft_unknown")
        check(draft.state == SmsSendState.AWAITING_CONFIRMATION) { "sms_confirmation_not_pending" }
        return send(draft)
    }

    private fun send(draft: SmsDraft): SmsDraft = try {
        val receipt = providerSend(draft)
        require(receipt.isNotBlank() && receipt.length <= 500) { "sms_provider_receipt_invalid" }
        draft.copy(state = SmsSendState.ACCEPTED_BY_PROVIDER, providerReceipt = receipt).also { drafts[draft.draftId] = it }
    } catch (error: Exception) {
        draft.copy(state = SmsSendState.FAILED).also { drafts[draft.draftId] = it }
        throw error
    }

    fun recognizesOwnerNumber(number: String): Boolean = owner.ownsPhone(number)

    fun allowsCapability(capability: String): Boolean = capability in setOf(
        "conversation.reply_draft", "conversation.reply_send",
    )
}
