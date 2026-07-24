package fr.mina.gateway

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BiometricGateTest {
    @Test fun locked_only_when_enabled_capable_and_not_yet_unlocked() {
        assertTrue(BiometricGate.isLocked(lockEnabled = true, canAuthenticate = true, unlocked = false))
        assertFalse(BiometricGate.isLocked(lockEnabled = true, canAuthenticate = true, unlocked = true))
    }

    @Test fun never_locks_out_when_no_biometric_enrolled() {
        // Garde-fou : verrou demandé mais aucune empreinte enrôlée → on N'ENFERME PAS dehors.
        assertFalse(BiometricGate.isLocked(lockEnabled = true, canAuthenticate = false, unlocked = false))
    }

    @Test fun disabled_lock_never_hides_content() {
        assertFalse(BiometricGate.isLocked(lockEnabled = false, canAuthenticate = true, unlocked = false))
    }
}
