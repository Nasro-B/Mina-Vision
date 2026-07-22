package fr.mina.gateway.camera

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CameraSessionControllerTest {
    @Test
    fun followsVisiblePermissionAndStreamingStates() {
        val controller = CameraSessionController()
        assertEquals(CameraSessionState.IDLE, controller.snapshot().state)

        assertFalse(controller.requestStart(permissionGranted = false, availableLenses = setOf(CameraLens.FRONT)))
        assertEquals(CameraSessionState.PERMISSION_REQUIRED, controller.snapshot().state)

        assertTrue(controller.permissionGranted(setOf(CameraLens.FRONT, CameraLens.BACK)))
        assertEquals(CameraSessionState.STARTING, controller.snapshot().state)
        assertTrue(controller.streamStarted())
        assertEquals(CameraSessionState.STREAMING, controller.snapshot().state)

        assertTrue(controller.requestStop())
        assertEquals(CameraSessionState.STOPPING, controller.snapshot().state)
        assertTrue(controller.streamStopped())
        assertEquals(CameraSessionState.IDLE, controller.snapshot().state)
    }

    @Test
    fun rejectsDoubleStartAndSwitchesOnlyToAnAvailableLogicalLens() {
        val controller = CameraSessionController()
        assertTrue(controller.requestStart(true, setOf(CameraLens.FRONT, CameraLens.BACK), CameraLens.FRONT))
        assertFalse(controller.requestStart(true, setOf(CameraLens.FRONT, CameraLens.BACK), CameraLens.FRONT))
        controller.streamStarted()
        assertTrue(controller.switchLens(CameraLens.BACK))
        assertEquals(CameraLens.BACK, controller.snapshot().lens)
        assertFalse(controller.switchLens(CameraLens.EXTERNAL))
    }

    @Test
    fun denialReturnsToPermissionRequiredWithoutStarting() {
        val controller = CameraSessionController()
        controller.requestStart(false, setOf(CameraLens.BACK))
        assertTrue(controller.permissionDenied())
        assertEquals(CameraSessionState.PERMISSION_REQUIRED, controller.snapshot().state)
        assertFalse(controller.streamStarted())
    }
}
