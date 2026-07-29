package fr.mina.gateway.messaging

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GatewayServiceStartPolicyTest {
    @Test
    fun runsLiveLoopsUnlessInstrumentationExplicitlyRequestsIsolation() {
        assertTrue(GatewayServiceStartPolicy.shouldStartLiveLoops(debugBuild = false, isolatedTestRequested = true))
        assertTrue(GatewayServiceStartPolicy.shouldStartLiveLoops(debugBuild = true, isolatedTestRequested = false))
        assertFalse(GatewayServiceStartPolicy.shouldStartLiveLoops(debugBuild = true, isolatedTestRequested = true))
    }
}
