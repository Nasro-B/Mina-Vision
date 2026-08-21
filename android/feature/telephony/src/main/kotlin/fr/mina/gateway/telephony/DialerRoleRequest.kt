package fr.mina.gateway.telephony

import android.app.role.RoleManager
import android.content.Context
import android.content.Intent

/**
 * Demande du rôle « application Téléphone par défaut » (ROLE_DIALER) — SPEC-MINA-COMMS-001 §7, Phase 5.
 * Pour répondre/refuser/raccrocher de vrais appels cellulaires, l'app doit tenir ce rôle (Android ne lie
 * l'InCallService que dans ce cas). L'octroi passe TOUJOURS par le dialogue SYSTÈME Android : cette classe
 * ne fait que FABRIQUER l'intent de demande ; c'est l'utilisateur qui accepte. Rien n'est accordé en
 * silence. Tant que le rôle n'est pas tenu, l'InCallService reste inerte et le téléphone fonctionne
 * normalement. L'activation réelle reste gatée par la porte HFP §6 (média).
 */
object DialerRoleRequest {

    fun isAvailable(context: Context): Boolean {
        val manager = context.getSystemService(RoleManager::class.java) ?: return false
        return manager.isRoleAvailable(RoleManager.ROLE_DIALER)
    }

    fun isHeld(context: Context): Boolean {
        val manager = context.getSystemService(RoleManager::class.java) ?: return false
        return manager.isRoleAvailable(RoleManager.ROLE_DIALER) && manager.isRoleHeld(RoleManager.ROLE_DIALER)
    }

    /** Intent du dialogue système « définir comme application Téléphone par défaut ». null si indisponible. */
    fun createRequestIntent(context: Context): Intent? {
        val manager = context.getSystemService(RoleManager::class.java) ?: return null
        if (!manager.isRoleAvailable(RoleManager.ROLE_DIALER)) return null
        return manager.createRequestRoleIntent(RoleManager.ROLE_DIALER)
    }
}
