package fr.mina.gateway.messaging

import org.json.JSONObject
import java.io.File
import java.nio.charset.StandardCharsets

fun interface SmsCommandDispatcher {
    fun dispatch(command: SmsCommand): SmsCommandReceipt
}

data class SmsCommandReceipt(val id: String, val state: String, val reason: String? = null) {
    init {
        require(id.matches(Regex("^cmd-[a-f0-9]{32}$"))) { "sms_receipt_id_invalid" }
        require(state in setOf("queued", "duplicate", "failed")) { "sms_receipt_state_invalid" }
        require(reason == null || reason.matches(Regex("^[a-z0-9_:-]{1,80}$"))) { "sms_receipt_reason_invalid" }
    }

    fun toJson(): String = JSONObject().apply {
        put("version", 1)
        put("id", id)
        put("state", state)
        if (reason != null) put("reason", reason)
    }.toString()
}

class SmsCommandFileProcessor(
    root: File,
    private val dispatcher: SmsCommandDispatcher,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val commands = root.resolve("commands").apply { mkdirs() }
    private val receipts = root.resolve("receipts").apply { mkdirs() }

    fun processPending(): Int {
        val files = commands.listFiles { file -> file.isFile && file.name.matches(COMMAND_FILE) }
            ?.sortedBy { it.name }
            ?.take(20)
            .orEmpty()
        files.forEach(::process)
        return files.size
    }

    private fun process(file: File) {
        val id = file.name.removeSuffix(".json")
        val receipt = try {
            val bytes = file.readBytes()
            require(bytes.size <= 16 * 1024) { "sms_command_too_large" }
            try {
                dispatcher.dispatch(SmsCommandParser.parse(String(bytes, StandardCharsets.UTF_8), now()))
            } finally {
                bytes.fill(0)
            }
        } catch (_: Exception) {
            SmsCommandReceipt(id, "failed", "command_rejected")
        }
        val temporary = receipts.resolve("$id.json.tmp")
        temporary.writeText(receipt.toJson(), StandardCharsets.UTF_8)
        val target = receipts.resolve("$id.json")
        if (target.exists()) check(target.delete()) { "sms_receipt_replace_failed" }
        check(temporary.renameTo(target)) { "sms_receipt_commit_failed" }
        file.delete()
    }

    private companion object {
        val COMMAND_FILE = Regex("^cmd-[a-f0-9]{32}\\.json$")
    }
}
