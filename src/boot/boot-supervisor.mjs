// Superviseur de boot (plan de durcissement T1.2). Cœur PUR et testable de la Vague 1 « boot
// increvable » : un registre de sous-systèmes, chacun démarré dans son propre try/catch.
//
// Le défaut à corriger : `src/ui/main.mjs` amorçait tous ses domaines dans un seul enchaînement
// linéaire (`whenReady().then(async …)`) où `createWindow()` était la DERNIÈRE action. Une seule
// exception (skill mal formé, port occupé, coffre illisible) rejetait avant la création de la
// fenêtre → processus vivants, AUCUNE fenêtre, aucun message. Trois incidents en une semaine.
//
// La règle qu'impose ce superviseur : un sous-système NON critique qui échoue est publié
// `unavailable(raison)` et le boot CONTINUE ; un sous-système CRITIQUE qui échoue est signalé sans
// équivoque, mais ne laisse jamais un processus zombie sans fenêtre. Ce module ne connaît ni
// Electron ni la fenêtre — il ne fait que discipliner l'ordre et l'isolement des démarrages, ce qui
// le rend entièrement vérifiable hors de l'application.

const CIRCLES = new Set(['coeur', 'maintenu', 'gele']);
const STATES = Object.freeze({ pending: 'pending', started: 'started', unavailable: 'unavailable', failed: 'failed' });

function validateSubsystem(subsystem, seen) {
  if (!subsystem || typeof subsystem !== 'object') throw new TypeError('boot_subsystem_invalid');
  const { id, circle = 'gele', critical = false, start } = subsystem;
  if (typeof id !== 'string' || !id) throw new TypeError('boot_subsystem_id_required');
  if (seen.has(id)) throw new Error(`boot_subsystem_duplicate:${id}`);
  if (!CIRCLES.has(circle)) throw new TypeError(`boot_subsystem_circle_invalid:${id}`);
  if (typeof critical !== 'boolean') throw new TypeError(`boot_subsystem_critical_invalid:${id}`);
  if (typeof start !== 'function') throw new TypeError(`boot_subsystem_start_required:${id}`);
  return { id, circle, critical, start };
}

// Un échec ne doit jamais faire fuiter un secret dans le journal ou l'écran de boot : la raison est
// tronquée et réduite au message, jamais l'objet d'erreur complet (qui pourrait porter une config).
function reasonOf(error) {
  const message = error && typeof error === 'object' && 'message' in error ? error.message : error;
  return String(message ?? 'erreur inconnue').slice(0, 300);
}

export function createBootSupervisor({ onProgress = () => {}, onCapability = () => {}, clock = () => 0 } = {}) {
  const subsystems = [];
  const seen = new Set();
  const results = new Map();

  function register(subsystem) {
    const valid = validateSubsystem(subsystem, seen);
    seen.add(valid.id);
    subsystems.push(valid);
    results.set(valid.id, Object.freeze({ id: valid.id, circle: valid.circle, critical: valid.critical, state: STATES.pending, reason: null, startedAt: null }));
    return valid.id;
  }

  function note(entry) {
    results.set(entry.id, Object.freeze(entry));
    try { onProgress(entry); } catch { /* le journal de progression ne casse jamais le boot */ }
    // Un sous-système en échec/indisponible est publié au catalogue de vérité avec sa raison
    // nommée — jamais masqué. Un critique en échec reste `failed` (l'appelant décide de l'écran
    // d'erreur) ; un non-critique devient `unavailable` et n'empêche personne d'avancer.
    if (entry.state === STATES.unavailable || entry.state === STATES.failed) {
      try { onCapability({ id: entry.id, status: 'unavailable', reason: entry.reason }); } catch { /* idem */ }
    }
  }

  // Démarre tous les sous-systèmes dans l'ordre d'enregistrement. Chacun est isolé : son échec
  // n'empêche jamais les suivants de démarrer. La promesse RÉSOUT toujours (jamais de rejet) et
  // rend le bilan — c'est la garantie « le boot ne meurt pas » réduite à une valeur de retour.
  async function startAll() {
    const failedCritical = [];
    for (const subsystem of subsystems) {
      const startedAt = Number(clock());
      try {
        await subsystem.start();
        note({ id: subsystem.id, circle: subsystem.circle, critical: subsystem.critical, state: STATES.started, reason: null, startedAt });
      } catch (error) {
        const reason = reasonOf(error);
        const state = subsystem.critical ? STATES.failed : STATES.unavailable;
        note({ id: subsystem.id, circle: subsystem.circle, critical: subsystem.critical, state, reason, startedAt });
        if (subsystem.critical) failedCritical.push({ id: subsystem.id, reason });
      }
    }
    return Object.freeze({
      ok: failedCritical.length === 0,
      failedCritical: Object.freeze(failedCritical),
      results: Object.freeze([...results.values()]),
    });
  }

  return Object.freeze({
    register,
    startAll,
    get: (id) => results.get(id) ?? null,
    list: () => Object.freeze([...results.values()]),
    STATES,
  });
}

export const BOOT_STATES = STATES;
