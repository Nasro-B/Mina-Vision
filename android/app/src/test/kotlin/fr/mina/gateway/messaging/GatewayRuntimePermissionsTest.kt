package fr.mina.gateway.messaging

import android.Manifest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class GatewayRuntimePermissionsTest {
    @Test
    fun `le demarrage de la passerelle ne demande jamais les notifications`() {
        val requested = gatewayRuntimePermissions()

        assertEquals(
            listOf(Manifest.permission.RECEIVE_SMS, Manifest.permission.SEND_SMS),
            requested,
        )
        assertFalse(requested.contains(Manifest.permission.POST_NOTIFICATIONS))
    }
}
