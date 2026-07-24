// Réparation du coffre quand le déverrouillage est DÉFINITIVEMENT bloqué (G1). Cas réel du
// 2026-07-24 : le blob DPAPI Windows du keyring est devenu indéchiffrable (la clé de chiffrement de
// l'utilisateur Windows a changé) ET la phrase de récupération n'a jamais été notée → ni DPAPI ni
// phrase ne rouvrent le coffre. Il faut un chemin de sortie SÛR, sinon Mina reste verrouillée pour
// toujours.
//
// Principes non négociables :
//   • on ne « répare » JAMAIS un coffre sain : probe() doit renvoyer `dpapi_unrecoverable` d'abord ;
//   • on ne SUPPRIME jamais rien : les fichiers sont ARCHIVÉS (renommés en .perdu-dpapi-<horodatage>),
//     donc si DPAPI revenait un jour, l'ancien coffre est toujours là ;
//   • la ré-initialisation qui suit RE-DEMANDE une phrase et l'AFFICHE — c'est la cause racine
//     (phrase jamais montrée) qu'on corrige en même temps.

export function createVaultRepair({
  safeStorage,
  keyringPath,
  archiveTargets = [], // chemins à archiver avec le keyring (mémoire sqlite + wal/shm)
  readFile,
  rename,
  access = null, // (path) => Promise — présent ? pour n'archiver que ce qui existe
  now = () => Date.now(),
} = {}) {
  if (!safeStorage?.decryptString || !keyringPath || typeof readFile !== 'function' || typeof rename !== 'function') {
    throw new TypeError('vault_repair_dependencies_required');
  }

  /**
   * État réel du coffre, sans rien modifier :
   *   - `uninitialized` : aucun keyring (premier lancement).
   *   - `healthy` : le wrappedMasterKey se déchiffre par DPAPI — surtout NE PAS réparer.
   *   - `dpapi_unrecoverable` : keyring présent mais DPAPI ne le déchiffre plus (le seul cas où
   *     l'archivage + ré-init est justifié SI l'utilisateur n'a pas la phrase).
   *   - `corrupt` : fichier illisible/incomplet.
   */
  async function probe() {
    let record;
    try {
      record = JSON.parse(await readFile(keyringPath, 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') return Object.freeze({ state: 'uninitialized' });
      return Object.freeze({ state: 'corrupt', reason: 'keyring_illisible' });
    }
    if (!record?.wrappedMasterKey || typeof record.wrappedMasterKey !== 'string') {
      return Object.freeze({ state: 'corrupt', reason: 'wrapped_key_absent' });
    }
    try {
      const wrapped = Buffer.from(record.wrappedMasterKey, 'base64');
      safeStorage.decryptString(wrapped); // ne garde jamais la valeur : on teste juste la faisabilité
      return Object.freeze({ state: 'healthy' });
    } catch (error) {
      return Object.freeze({ state: 'dpapi_unrecoverable', reason: String(error?.message ?? error).slice(0, 160) });
    }
  }

  /**
   * Archive le keyring + la mémoire sous un suffixe daté. NE s'exécute QUE si le coffre est
   * réellement `dpapi_unrecoverable` (garde interne : on relit l'état, on ne fait pas confiance à
   * l'appelant). Retourne la liste des fichiers archivés — l'appelant ré-initialise ENSUITE.
   */
  async function archiveUnrecoverable() {
    const state = await probe();
    if (state.state !== 'dpapi_unrecoverable') {
      throw new Error(`vault_repair_refuse:${state.state}`);
    }
    const stamp = new Date(Number(now())).toISOString().replace(/[:.]/gu, '-');
    const suffix = `.perdu-dpapi-${stamp}`;
    const archived = [];
    for (const target of [keyringPath, ...archiveTargets]) {
      if (access) {
        try { await access(target); } catch { continue; } // on n'archive que ce qui existe
      }
      try {
        await rename(target, `${target}${suffix}`);
        archived.push(target);
      } catch (error) {
        if (error?.code === 'ENOENT') continue; // fichier disparu entre-temps : sans gravité
        throw error;
      }
    }
    return Object.freeze({ archived: Object.freeze(archived), suffix });
  }

  return Object.freeze({ probe, archiveUnrecoverable });
}
