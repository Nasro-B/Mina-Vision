package fr.mina.gateway.telephony

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class IncomingCallPolicyTest {

    private fun ready(): IncomingCallPolicy.Readiness =
        IncomingCallPolicy.evaluateReadiness(IncomingCallPolicy.READINESS_CONDITIONS.associateWith { true })

    @Test
    fun observationNeDecrocheJamais() {
        val d = IncomingCallPolicy.evaluateIncomingCall(readiness = ready(), level = "observe")
        assertFalse(d.eligible)
        assertEquals("observation_only", d.reason)
    }

    @Test
    fun pasPretBloque() {
        val partial = IncomingCallPolicy.evaluateReadiness(mapOf("signed_identity" to true))
        val d = IncomingCallPolicy.evaluateIncomingCall(readiness = partial, level = "assisted")
        assertFalse(d.eligible)
        assertTrue(d.reason!!.startsWith("not_ready:"))
    }

    @Test
    fun urgenceRefusee() {
        val d = IncomingCallPolicy.evaluateIncomingCall(readiness = ready(), numberE164 = "112", level = "assisted")
        assertFalse(d.eligible)
        assertEquals("emergency_or_short", d.reason)
    }

    @Test
    fun unSeulAppelActif() {
        val d = IncomingCallPolicy.evaluateIncomingCall(
            readiness = ready(), numberE164 = "+33612345678", level = "assisted", activeMinaCalls = 1,
        )
        assertFalse(d.eligible)
        assertEquals("concurrent_call", d.reason)
    }

    @Test
    fun piloteNumeroInconnuRefuse() {
        val d = IncomingCallPolicy.evaluateIncomingCall(
            readiness = ready(), numberE164 = "+33600000000", level = "pilot",
            knownContacts = listOf("+33612345678"),
        )
        assertFalse(d.eligible)
        assertEquals("unknown_number", d.reason)
    }

    @Test
    fun assisteNumeroNormalEligible() {
        val d = IncomingCallPolicy.evaluateIncomingCall(
            readiness = ready(), numberE164 = "+33612345678", level = "assisted",
        )
        assertTrue(d.eligible)
        assertEquals(null, d.reason)
    }

    @Test
    fun masqueCacheLeMilieuDuNumero() {
        assertEquals("+336••••5678", CallSnapshot.mask("+33 6 12 34 56 78"))
        assertEquals("inconnu", CallSnapshot.mask(null))
    }
}
