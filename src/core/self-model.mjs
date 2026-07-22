// Self-model persistant de Mina Vision — identité, but courant, focus, incertitudes, erreurs
// récentes. TOUT est DÉRIVÉ d'événements réels du runtime (missions, journal technique) : ce
// fichier n'accepte aucun texte libre auto-décrit, c'est ce qui l'empêche de devenir une
// hallucination persistée. Injecté au démarrage de la session vocale à côté de l'état matériel.

const MAX_LIST = 5;
const MAX_TEXT = 200;

const DEFAULT_STATE = Object.freeze({
  version: 1,
  identity: 'Mina Vision, agent local de Nasro : voix, navigateur, bureau Windows, téléphone Android.',
  currentGoal: null,
  focus: null,
  uncertainties: Object.freeze([]),
  updatedAt: 0,
});

const bounded = (value) => String(value ?? '').replace(/\s+/gu, ' ').trim().slice(0, MAX_TEXT);

const boundedList = (list) => Object.freeze(
  [...new Set((Array.isArray(list) ? list : []).map(bounded).filter(Boolean))].slice(0, MAX_LIST),
);

export function createSelfModel({ statePath, readFile, writeFile, now = Date.now } = {}) {
  if (!statePath || typeof readFile !== 'function' || typeof writeFile !== 'function') {
    throw new TypeError('self_model_dependencies_required');
  }
  let state = DEFAULT_STATE;
  let writing = Promise.resolve();

  const persist = () => {
    // Écriture séquencée best-effort : une panne disque ne casse jamais la voix.
    writing = writing
      .then(() => writeFile(statePath, JSON.stringify(state, null, 2), 'utf8'))
      .catch(() => {});
    return writing;
  };

  return Object.freeze({
    async load() {
      try {
        const parsed = JSON.parse(await readFile(statePath, 'utf8'));
        state = Object.freeze({
          ...DEFAULT_STATE,
          identity: bounded(parsed.identity) || DEFAULT_STATE.identity,
          currentGoal: parsed.currentGoal === null ? null : bounded(parsed.currentGoal) || null,
          focus: parsed.focus === null ? null : bounded(parsed.focus) || null,
          uncertainties: boundedList(parsed.uncertainties),
          updatedAt: Number.isFinite(parsed.updatedAt) ? parsed.updatedAt : 0,
        });
      } catch {
        state = DEFAULT_STATE; // fichier absent ou corrompu : repartir des défauts, jamais crasher
      }
      return state;
    },

    snapshot: () => state,

    // Seule porte d'écriture : des ÉVÉNEMENTS runtime, pas du texte libre.
    observeEvent(event) {
      const type = event?.type;
      if (type === 'mission_started') {
        state = Object.freeze({ ...state, currentGoal: bounded(event.state?.goal) || null, updatedAt: now() });
      } else if (type === 'mission_completed') {
        state = Object.freeze({
          ...state,
          currentGoal: null,
          focus: bounded(event.state?.summary || event.state?.goal) || state.focus,
          updatedAt: now(),
        });
      } else if (type === 'mission_stopped' || type === 'mission_error') {
        const reason = bounded(event.state?.reason || event.error);
        state = Object.freeze({
          ...state,
          currentGoal: null,
          uncertainties: boundedList([reason ? `mission interrompue : ${reason}` : null, ...state.uncertainties]),
          updatedAt: now(),
        });
      } else if (type === 'domain_degraded') {
        state = Object.freeze({
          ...state,
          uncertainties: boundedList([`domaine ${bounded(event.domain)} dégradé`, ...state.uncertainties]),
          updatedAt: now(),
        });
      } else {
        return state;
      }
      void persist();
      return state;
    },

    flush: () => persist(),
  });
}

// Brief parlé/injecté : les erreurs récentes arrivent du journal technique AU MOMENT de la
// composition (jamais dupliquées dans l'état — une seule source de vérité).
export function composeSelfBrief(state = DEFAULT_STATE, { recentErrors = [] } = {}) {
  const lines = [state.identity];
  lines.push(state.currentGoal ? `Mission en cours : ${state.currentGoal}.` : 'Aucune mission en cours.');
  if (state.focus) lines.push(`Dernier travail terminé : ${state.focus}.`);
  if (state.uncertainties.length > 0) lines.push(`Incertitudes connues : ${state.uncertainties.join(' ; ')}.`);
  const errors = boundedList(recentErrors.map((entry) => `${entry.scope} (${entry.code})`));
  if (errors.length > 0) lines.push(`Erreurs récentes : ${errors.join(', ')}.`);
  return lines.join(' ');
}
