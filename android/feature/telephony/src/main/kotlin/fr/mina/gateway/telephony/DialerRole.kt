package fr.mina.gateway.telephony

import android.app.role.RoleManager
import android.content.Context
import android.content.Intent

/**
 * Rôle téléphone / dialer par défaut (SPEC-MINA-COMMS-001 Phase 5 « Implémenter le rôle téléphone »).
 * Fournit l'état du rôle et l'intent de DEMANDE ; il ne l'envoie jamais tout seul — l'octroi on-device
 * par l'utilisateur reste une action explicite (§19 : rien ne s'active automatiquement). Sans rôle
 * dialer, l'[MinaInCallService] ne reçoit pas les appels : ce helper est le préalable au contrôle
 * Android, le média restant désactivé (Phase 6 / porte HFP §6).
 */
object DialerRole {

    fun isAvailable(context: Context): Boolean {
        val manager = context.getSystemService(RoleManager::class.java) ?: return false
        return manager.isRoleAvailable(RoleManager.ROLE_DIALER)
    }

    fun isHeld(context: Context): Boolean {
        val manager = context.getSystemService(RoleManager::class.java) ?: return false
        return manager.isRoleAvailable(RoleManager.ROLE_DIALER) && manager.isRoleHeld(RoleManager.ROLE_DIALER)
    }

    /** Intent à lancer EXPLICITEMENT pour demander le rôle dialer (jamais automatique). Null si indisponible. */
    fun requestIntent(context: Context): Intent? {
        val manager = context.getSystemService(RoleManager::class.java) ?: return null
        if (!manager.isRoleAvailable(RoleManager.ROLE_DIALER)) return null
        return manager.createRequestRoleIntent(RoleManager.ROLE_DIALER)
    }
}
