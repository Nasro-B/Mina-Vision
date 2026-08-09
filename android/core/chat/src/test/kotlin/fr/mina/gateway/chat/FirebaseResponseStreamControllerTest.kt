package fr.mina.gateway.chat

import fr.mina.gateway.protocol.AssistantResponseFrame
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FirebaseResponseStreamControllerTest {
    @Test
    fun `attache RTDB seulement apres claims exacts et le retire au terminal`() {
        val source = FakeSource()
        val stream = FirebaseResponseStream(source = source, now = { 1_000L })
        var resolve: ((FcmSyncTarget?) -> Unit)? = null
        val controller = FirebaseResponseStreamController(
            deviceId = "device-samsung",
            stream = stream,
            resolveSession = { expectedDeviceId, callback ->
                assertEquals("device-samsung", expectedDeviceId)
                resolve = callback
            },
            onEvent = {},
        )

        controller.accept(started())
        resolve?.invoke(null)
        assertFalse(source.active)

        controller.accept(started())
        resolve?.invoke(FcmSyncTarget(ownerId = "owner-test", deviceId = "device-samsung"))
        assertTrue(source.active)

        controller.accept(completed())
        assertFalse(source.active)
    }

    @Test
    fun `une resolution tardive ne rouvre pas un flux deja termine`() {
        val source = FakeSource()
        val stream = FirebaseResponseStream(source = source, now = { 1_000L })
        var resolve: ((FcmSyncTarget?) -> Unit)? = null
        val controller = FirebaseResponseStreamController(
            deviceId = "device-samsung",
            stream = stream,
            resolveSession = { _, callback -> resolve = callback },
            onEvent = {},
        )

        controller.accept(started())
        controller.accept(completed())
        resolve?.invoke(FcmSyncTarget(ownerId = "owner-test", deviceId = "device-samsung"))

        assertFalse(source.active)
    }

    private fun started() = AssistantResponseFrame(
        type = "assistant.response.started",
        responseId = RESPONSE_ID,
        sourceEventId = SOURCE_EVENT_ID,
        sequence = 0,
        text = null,
        code = null,
    )

    private fun completed() = AssistantResponseFrame(
        type = "assistant.response.completed",
        responseId = RESPONSE_ID,
        sourceEventId = SOURCE_EVENT_ID,
        sequence = 2,
        text = "Bonjour",
        code = null,
    )

    private class FakeSource : FirebaseResponseStreamSource {
        var active = false
            private set

        override fun watch(
            ownerId: String,
            responseId: String,
            onFrame: (FirebaseResponseStreamFrame) -> Unit,
            onError: () -> Unit,
        ): FirebaseResponseStreamSubscription {
            active = true
            return FirebaseResponseStreamSubscription { active = false }
        }
    }

    private companion object {
        const val RESPONSE_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV"
        const val SOURCE_EVENT_ID = "01BX5ZZKBKACTAV9WEVGEMMVRZ"
    }
}
