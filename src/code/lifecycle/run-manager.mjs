// Cycle de vie T3.3 (SPEC agente-codage V3) : lance un projet localement (dev server, CLI, Electron) en
// processus GÉRÉ — un seul run à la fois, arrêt propre. La PREUVE d'exécution est une SONDE (HTTP verte
// ou motif stdout), JAMAIS « la commande est partie ». Sans sonde verte dans le délai, on arrête et on le
// DIT (jamais « lancé » sans preuve). `spawn` et `wait` INJECTÉS → testable sans vrai processus.

export function createRunManager({ spawn, wait = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now() } = {}) {
  if (typeof spawn !== 'function') throw new TypeError('run_manager_spawn_required');
  let active = null;

  return Object.freeze({
    async start({ dir, command, args = [], probe, timeoutMs = 30_000, pollMs = 250 } = {}) {
      if (active) throw new Error('run_manager_already_running'); // un seul run par gestionnaire
      if (typeof probe !== 'function') throw new TypeError('run_manager_probe_required'); // preuve obligatoire
      const proc = spawn({ command, args, cwd: dir });
      active = proc;
      const deadline = now() + timeoutMs;
      // Sonde en boucle jusqu'à la preuve verte ou l'échéance.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        // eslint-disable-next-line no-await-in-loop
        if (await probe(proc)) return Object.freeze({ started: true, pid: proc?.pid ?? null, proof: 'sonde_verte' });
        if (now() >= deadline) break;
        // eslint-disable-next-line no-await-in-loop
        await wait(pollMs);
      }
      // Jamais prouvé démarré → arrêt propre + honnêteté.
      try { proc?.kill?.(); } catch { /* déjà mort */ }
      active = null;
      return Object.freeze({ started: false, reason: 'sonde_jamais_verte', proof: null });
    },

    async stop() {
      if (!active) return Object.freeze({ stopped: false, reason: 'aucun_run_actif' });
      try { active.kill?.(); } finally { active = null; }
      return Object.freeze({ stopped: true });
    },

    isRunning: () => Boolean(active),
  });
}
