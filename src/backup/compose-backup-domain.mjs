import { hkdfSync } from 'node:crypto';
import { createFirebaseBackup } from './firebase-backup.mjs';
import { createBackupService } from './backup-service.mjs';
import { createRestoreService } from './restore-service.mjs';

// Composition du domaine SAUVEGARDE chiffrée de la mémoire vers Firebase Storage. Le module
// firebase-backup + backup-service + restore-service existaient et étaient testés, mais n'étaient
// composés NULLE PART (réconciliation T16 / backlog T9 restés ouverts). Ici on les branche, de façon
// FAIL-HONEST : sans configuration Firebase, le domaine est « disabled » avec une raison claire —
// jamais une fausse promesse de sauvegarde.
//
// Clé de sauvegarde = dérivée HKDF de la clé maître (jamais la clé maître elle-même), domaine séparé
// de la mémoire et du journal. Aucune donnée en clair ne quitte la machine : le backup-service
// chiffre AVANT l'envoi ; Firebase ne voit que du ciphertext scopé au propriétaire.

const BACKUP_HKDF_INFO = 'memory-backup v1';

export function deriveBackupKeyFromMaster(masterKey) {
  const source = Buffer.from(masterKey ?? []);
  if (source.length !== 32) throw new TypeError('backup_master_key_required');
  return Buffer.from(hkdfSync('sha256', source, Buffer.from('Mina Vision local memory v1', 'utf8'), Buffer.from(BACKUP_HKDF_INFO, 'utf8'), 32));
}

/**
 * @param {object}   opts
 * @param {Buffer}   opts.masterKey            clé maître du coffre (32 octets)
 * @param {boolean}  opts.configured           Firebase réellement configuré (projet + bucket + creds)
 * @param {Function} [opts.createClient]        async () => client SDK Firebase (put/get/exists/delete/list/authenticate)
 * @param {Function} [opts.authTokenProvider]  async () => jeton d'auth (anonyme) pour scoper au propriétaire
 * @param {string}   [opts.expectedOwnerId]    identifiant propriétaire attendu (garde anti-usurpation)
 * @param {string}   [opts.deviceId]           identifiant de cet appareil
 * @returns {Promise<{ state, reason, backup, restore }>}
 */
export async function composeBackupDomain({
  masterKey,
  configured = false,
  createClient = null,
  authTokenProvider = null,
  expectedOwnerId = null,
  deviceId = null,
} = {}) {
  if (!configured) {
    return Object.freeze({ state: 'disabled', reason: 'firebase_non_configure', backup: null, restore: null });
  }
  if (typeof createClient !== 'function' || typeof authTokenProvider !== 'function' || !expectedOwnerId || !deviceId) {
    return Object.freeze({ state: 'disabled', reason: 'backup_dependances_incompletes', backup: null, restore: null });
  }

  let backupKey;
  try {
    backupKey = deriveBackupKeyFromMaster(masterKey);
  } catch {
    return Object.freeze({ state: 'disabled', reason: 'backup_master_key_invalide', backup: null, restore: null });
  }

  try {
    const client = await createClient();
    const remote = createFirebaseBackup({ client, authTokenProvider, expectedOwnerId, deviceId });
    const backup = createBackupService({ remote, backupKey });
    const restore = createRestoreService({ remote, backupKey });
    return Object.freeze({ state: 'operational', reason: null, backup, restore });
  } catch (error) {
    // Firebase configuré mais injoignable (réseau, auth, App Check) : dégradé HONNÊTE, jamais un crash.
    return Object.freeze({
      state: 'degraded',
      reason: `backup_indisponible:${String(error?.message ?? error).slice(0, 120)}`,
      backup: null,
      restore: null,
    });
  } finally {
    backupKey.fill(0);
  }
}
