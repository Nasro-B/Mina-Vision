package fr.mina.gateway.camera

enum class CameraSessionState { IDLE, PERMISSION_REQUIRED, STARTING, STREAMING, STOPPING }
enum class CameraLens { FRONT, BACK, EXTERNAL }

data class CameraSessionSnapshot(
    val state: CameraSessionState,
    val lens: CameraLens?,
    val availableLenses: Set<CameraLens>,
)

class CameraSessionController {
    private var state = CameraSessionState.IDLE
    private var lens: CameraLens? = null
    private var availableLenses: Set<CameraLens> = emptySet()

    @Synchronized
    fun snapshot(): CameraSessionSnapshot = CameraSessionSnapshot(state, lens, availableLenses.toSet())

    @Synchronized
    fun requestStart(
        permissionGranted: Boolean,
        availableLenses: Set<CameraLens>,
        preferredLens: CameraLens = CameraLens.FRONT,
    ): Boolean {
        if (state != CameraSessionState.IDLE || availableLenses.isEmpty()) return false
        this.availableLenses = availableLenses.toSet()
        lens = selectLens(preferredLens)
        state = if (permissionGranted) CameraSessionState.STARTING else CameraSessionState.PERMISSION_REQUIRED
        return permissionGranted
    }

    @Synchronized
    fun permissionGranted(availableLenses: Set<CameraLens>, preferredLens: CameraLens = lens ?: CameraLens.FRONT): Boolean {
        if (state != CameraSessionState.PERMISSION_REQUIRED || availableLenses.isEmpty()) return false
        this.availableLenses = availableLenses.toSet()
        lens = selectLens(preferredLens)
        state = CameraSessionState.STARTING
        return true
    }

    @Synchronized
    fun permissionDenied(): Boolean {
        if (state != CameraSessionState.PERMISSION_REQUIRED) return false
        return true
    }

    @Synchronized
    fun streamStarted(): Boolean {
        if (state != CameraSessionState.STARTING) return false
        state = CameraSessionState.STREAMING
        return true
    }

    @Synchronized
    fun switchLens(next: CameraLens): Boolean {
        if (state != CameraSessionState.STREAMING || next !in availableLenses || next == lens) return false
        lens = next
        return true
    }

    @Synchronized
    fun requestStop(): Boolean {
        if (state !in setOf(CameraSessionState.STARTING, CameraSessionState.STREAMING)) return false
        state = CameraSessionState.STOPPING
        return true
    }

    @Synchronized
    fun streamStopped(): Boolean {
        if (state != CameraSessionState.STOPPING) return false
        state = CameraSessionState.IDLE
        lens = null
        availableLenses = emptySet()
        return true
    }

    private fun selectLens(preferred: CameraLens): CameraLens = when {
        preferred in availableLenses -> preferred
        CameraLens.FRONT in availableLenses -> CameraLens.FRONT
        CameraLens.BACK in availableLenses -> CameraLens.BACK
        else -> availableLenses.first()
    }
}
