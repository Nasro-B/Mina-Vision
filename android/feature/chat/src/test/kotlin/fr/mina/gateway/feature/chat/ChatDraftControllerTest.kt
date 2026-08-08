package fr.mina.gateway.feature.chat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatDraftControllerTest {
    @Test
    fun `garde le brouillon apres un echec de persistance`() {
        val controller = ChatDraftController()
        controller.update("message a conserver")
        val submitted = controller.beginSend()

        controller.finishSend(submitted!!, persisted = false)

        assertEquals("message a conserver", controller.draft)
        assertFalse(controller.sending)
    }

    @Test
    fun `refuse un double envoi tant que la persistance est en cours`() {
        val controller = ChatDraftController()
        controller.update("un seul envoi")

        assertEquals("un seul envoi", controller.beginSend())
        assertTrue(controller.sending)
        assertNull(controller.beginSend())
    }

    @Test
    fun `efface seulement le brouillon qui a ete persiste`() {
        val controller = ChatDraftController()
        controller.update("premier brouillon")
        val submitted = controller.beginSend()!!
        controller.update("brouillon modifie pendant l envoi")

        controller.finishSend(submitted, persisted = true)

        assertEquals("brouillon modifie pendant l envoi", controller.draft)
        assertFalse(controller.sending)
    }

    @Test
    fun `efface le brouillon apres une persistance reussie`() {
        val controller = ChatDraftController()
        controller.update("brouillon persiste")
        val submitted = controller.beginSend()!!

        controller.finishSend(submitted, persisted = true)

        assertEquals("", controller.draft)
        assertFalse(controller.sending)
    }
}
