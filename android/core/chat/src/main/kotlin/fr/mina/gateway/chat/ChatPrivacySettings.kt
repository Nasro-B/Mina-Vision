package fr.mina.gateway.chat

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.preferencesDataStore
import java.io.IOException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.map

private val Context.chatPrivacyDataStore by preferencesDataStore(name = "mina-chat-privacy")

data class ChatPrivacySettings(
    val showLockScreenPreview: Boolean = false,
    val secureChatWindow: Boolean = true,
    val huaweiForegroundConsent: Boolean = false,
    val notificationPromptAttempted: Boolean = false,
    val notificationRefusalObserved: Boolean = false,
)

/**
 * Réglages non sensibles du chat. Les clés, messages et identifiants restent hors de DataStore.
 */
class ChatPrivacySettingsStore(context: Context) {
    private val appContext = context.applicationContext

    val settings: Flow<ChatPrivacySettings> = appContext.chatPrivacyDataStore.data
        .catch { error ->
            if (error is IOException) emit(emptyPreferences()) else throw error
        }
        .map { preferences ->
            ChatPrivacySettings(
                showLockScreenPreview = preferences[SHOW_LOCK_SCREEN_PREVIEW] ?: false,
                secureChatWindow = preferences[SECURE_CHAT_WINDOW] ?: true,
                huaweiForegroundConsent = preferences[HUAWEI_FOREGROUND_CONSENT] ?: false,
                notificationPromptAttempted = preferences[NOTIFICATION_PROMPT_ATTEMPTED] ?: false,
                notificationRefusalObserved = preferences[NOTIFICATION_REFUSAL_OBSERVED] ?: false,
            )
        }

    suspend fun markNotificationPromptAttempted() {
        appContext.chatPrivacyDataStore.edit { preferences ->
            preferences[NOTIFICATION_PROMPT_ATTEMPTED] = true
        }
    }

    suspend fun markNotificationRefusalObserved() {
        appContext.chatPrivacyDataStore.edit { preferences ->
            preferences[NOTIFICATION_REFUSAL_OBSERVED] = true
        }
    }

    private companion object {
        val SHOW_LOCK_SCREEN_PREVIEW = booleanPreferencesKey("show_lock_screen_preview")
        val SECURE_CHAT_WINDOW = booleanPreferencesKey("secure_chat_window")
        val HUAWEI_FOREGROUND_CONSENT = booleanPreferencesKey("huawei_foreground_consent")
        val NOTIFICATION_PROMPT_ATTEMPTED = booleanPreferencesKey("notification_prompt_attempted")
        val NOTIFICATION_REFUSAL_OBSERVED = booleanPreferencesKey("notification_refusal_observed")
    }
}
