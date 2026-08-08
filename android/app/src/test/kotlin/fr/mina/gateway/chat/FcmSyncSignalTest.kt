package fr.mina.gateway.chat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class FcmSyncSignalTest {
    private val target = FcmSyncTarget(ownerId = "owner-abc", deviceId = "device-abc")

    @Test
    fun `accepte uniquement le signal opaque exact pour la session courante`() {
        val signal = FcmSyncSignal.parse(
            mapOf(
                "type" to "sync",
                "ownerId" to "owner-abc",
                "deviceId" to "device-abc",
                "highWatermark" to "42",
            ),
            target,
        )

        assertEquals(FcmSyncSignal(highWatermark = 42L), signal)
    }

    @Test
    fun `refuse les champs supplementaires, la mauvaise cible et les watermarks invalides`() {
        val valid = mapOf(
            "type" to "sync",
            "ownerId" to "owner-abc",
            "deviceId" to "device-abc",
            "highWatermark" to "42",
        )

        assertNull(FcmSyncSignal.parse(valid + ("title" to "secret"), target))
        assertNull(FcmSyncSignal.parse(valid + ("ownerId" to "other-owner"), target))
        assertNull(FcmSyncSignal.parse(valid + ("deviceId" to "other-device"), target))
        assertNull(FcmSyncSignal.parse(valid + ("highWatermark" to "-1"), target))
        assertNull(FcmSyncSignal.parse(valid + ("highWatermark" to "9007199254740992"), target))
    }

    @Test
    fun `refuse une session sans claims owner appareil exacts`() {
        assertNull(FcmSyncTarget.fromClaims(emptyMap(), expectedDeviceId = "device-abc"))
        assertNull(
            FcmSyncTarget.fromClaims(
                mapOf("owner_id" to "owner-abc", "device_id" to "other-device"),
                expectedDeviceId = "device-abc",
            ),
        )
    }
}
