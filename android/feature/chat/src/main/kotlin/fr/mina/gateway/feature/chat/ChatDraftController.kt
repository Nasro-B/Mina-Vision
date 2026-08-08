package fr.mina.gateway.feature.chat

/** État éphémère du composeur : le brouillon ne part jamais avant l'écriture Room réussie. */
internal class ChatDraftController {
    var draft: String = ""
        private set
    var sending: Boolean = false
        private set

    fun update(value: String) {
        draft = value
    }

    fun beginSend(): String? {
        if (sending || draft.isBlank()) return null
        sending = true
        return draft
    }

    fun finishSend(submitted: String, persisted: Boolean) {
        if (persisted && draft == submitted) draft = ""
        sending = false
    }
}
