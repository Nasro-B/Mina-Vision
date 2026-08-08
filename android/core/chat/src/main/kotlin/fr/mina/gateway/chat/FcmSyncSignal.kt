package fr.mina.gateway.chat

private val FCM_ID = Regex("^[A-Za-z0-9._:-]{1,160}$")
private const val MAX_SAFE_WATERMARK = 9_007_199_254_740_991L

data class FcmSyncTarget(val ownerId: String, val deviceId: String) {
    init {
        require(FCM_ID.matches(ownerId)) { "fcm_owner_id_invalid" }
        require(FCM_ID.matches(deviceId)) { "fcm_device_id_invalid" }
    }

    companion object {
        fun fromClaims(claims: Map<String, Any?>, expectedDeviceId: String): FcmSyncTarget? {
            val ownerId = claims["owner_id"] as? String ?: return null
            val deviceId = claims["device_id"] as? String ?: return null
            if (deviceId != expectedDeviceId) return null
            return runCatching { FcmSyncTarget(ownerId, deviceId) }.getOrNull()
        }
    }
}

data class FcmSyncSignal(val highWatermark: Long) {
    companion object {
        private val REQUIRED_KEYS = setOf("type", "ownerId", "deviceId", "highWatermark")

        fun parse(data: Map<String, String>, target: FcmSyncTarget): FcmSyncSignal? {
            if (data.keys != REQUIRED_KEYS || data["type"] != "sync"
                || data["ownerId"] != target.ownerId || data["deviceId"] != target.deviceId
            ) return null
            val highWatermark = data["highWatermark"]?.toLongOrNull()
                ?.takeIf { it in 0L..MAX_SAFE_WATERMARK }
                ?: return null
            return FcmSyncSignal(highWatermark)
        }
    }
}
