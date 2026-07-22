// ACL Windows des dossiers sensibles créés par le runtime (Task 4 / R-04) : journal, coffres,
// bases. harden() coupe l'héritage et ne laisse que l'utilisateur courant (+ SYSTEM) ; jamais
// exécuté sur une racine non validée — la liste des cibles est construite par l'appelant à
// partir des dossiers qu'IL a créés. Fail-soft : un échec icacls est rapporté, jamais fatal.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const FORBIDDEN_TARGETS = [
  /^[a-z]:\\?$/iu, // une racine de volume entière — jamais.
  /^\\\\/u, // chemin réseau.
];

export function createLocalPathPermissions({
  runIcacls = async (args) => (await execFileAsync('icacls', args, { windowsHide: true })).stdout,
  ownerAccount = process.env.USERNAME ? `${process.env.USERDOMAIN ?? '.'}\\${process.env.USERNAME}` : null,
} = {}) {
  function assertTarget(path) {
    const value = String(path ?? '').trim();
    if (!value || FORBIDDEN_TARGETS.some((pattern) => pattern.test(value))) {
      throw new TypeError('acl_target_invalid');
    }
    return value;
  }

  return Object.freeze({
    // Restreint le dossier au seul utilisateur courant + SYSTEM, héritage coupé, récursif.
    async harden(path) {
      const target = assertTarget(path);
      if (!ownerAccount) return Object.freeze({ hardened: false, error: 'owner_account_unavailable' });
      try {
        await runIcacls([target, '/inheritance:r', '/grant:r', `${ownerAccount}:(OI)(CI)F`, '/grant:r', 'SYSTEM:(OI)(CI)F', '/T', '/C', '/Q']);
        return Object.freeze({ hardened: true, target, ownerAccount });
      } catch (error) {
        return Object.freeze({ hardened: false, target, error: String(error?.message ?? error).slice(0, 300) });
      }
    },

    // Rapporte les comptes présents dans l'ACL — le démarrage peut signaler un écart, il ne
    // supprime jamais un ACE de lui-même.
    async inspect(path) {
      const target = assertTarget(path);
      try {
        const output = String(await runIcacls([target]));
        const accounts = [...new Set([...output.matchAll(/^\s*(?:[A-Za-z]:.*?\s)?([^\s:]+\\[^\s:]+|Tout le monde|Everyone|BUILTIN\\[^:]+|AUTORITE NT\\[^:]+|NT AUTHORITY\\[^:]+):/gmu)]
          .map((match) => match[1]))];
        const broadGroups = accounts.filter((account) => /everyone|tout le monde|builtin\\(?:users|utilisateurs)/iu.test(account));
        return Object.freeze({ target, accounts: Object.freeze(accounts), broadGroups: Object.freeze(broadGroups) });
      } catch (error) {
        return Object.freeze({ target, accounts: Object.freeze([]), broadGroups: Object.freeze([]), error: String(error?.message ?? error).slice(0, 300) });
      }
    },
  });
}
