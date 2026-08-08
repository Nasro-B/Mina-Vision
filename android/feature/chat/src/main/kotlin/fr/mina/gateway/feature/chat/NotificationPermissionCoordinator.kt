package fr.mina.gateway.feature.chat

internal enum class ChatNotificationPermissionStatus {
    NOT_REQUIRED,
    PAIRING_REQUIRED,
    GRANTED,
    REQUESTABLE,
    DENIED,
    DENIED_PERMANENTLY,
}

/**
 * Politique pure : la permission est toujours déclenchée par une action visible de l'utilisateur.
 */
internal object NotificationPermissionCoordinator {
    private const val NOTIFICATION_RUNTIME_PERMISSION_API = 33

    fun status(
        apiLevel: Int,
        paired: Boolean,
        granted: Boolean,
        promptAttempted: Boolean = false,
        refusalObserved: Boolean = false,
        shouldShowRationale: Boolean = false,
    ): ChatNotificationPermissionStatus = when {
        apiLevel < NOTIFICATION_RUNTIME_PERMISSION_API -> ChatNotificationPermissionStatus.NOT_REQUIRED
        !paired -> ChatNotificationPermissionStatus.PAIRING_REQUIRED
        granted -> ChatNotificationPermissionStatus.GRANTED
        !promptAttempted -> ChatNotificationPermissionStatus.REQUESTABLE
        !refusalObserved || shouldShowRationale -> ChatNotificationPermissionStatus.DENIED
        else -> ChatNotificationPermissionStatus.DENIED_PERMANENTLY
    }
}
