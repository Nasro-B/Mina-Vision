// Fenêtrage intelligent du contexte code : fichiers chargés, historique d'actions, échecs de
// tests — avec éviction ordonnée quand le budget de tokens déborde. Jamais évincés : fichiers
// épinglés (MINA.md/AGENTS.md, fichier en cours d'édition), plan actif, derniers résultats de test.

export const estimateTokens = (text) => Math.ceil(String(text ?? '').length / 4);

const LOW_RELEVANCE = 0.3;
const OLD_ACTION_CYCLES = 10;
const OLD_PASSED_TEST_CYCLES = 5;

export function createCodeContextWindow({
  maxTokens = 128_000,
  reservedForResponse = 4_000,
  tokenizer = estimateTokens,
} = {}) {
  if (!Number.isFinite(maxTokens) || maxTokens <= 0) throw new Error('code_context_max_tokens_invalid');
  if (!Number.isFinite(reservedForResponse) || reservedForResponse < 0 || reservedForResponse >= maxTokens) {
    throw new Error('code_context_reserve_invalid');
  }

  const files = new Map();
  let actions = [];
  let testFailures = [];
  let activePlan = null;
  let cycle = 0;

  const budget = maxTokens - reservedForResponse;

  const fileTokens = () => [...files.values()].reduce((total, file) => total + tokenizer(file.content), 0);
  const actionTokens = () => actions.reduce((total, entry) => total + tokenizer(entry.text), 0);
  const failureTokens = () => testFailures.reduce((total, entry) => total + tokenizer(entry.text), 0);
  const planTokens = () => (activePlan ? tokenizer(JSON.stringify(activePlan)) : 0);
  const totalTokens = () => fileTokens() + actionTokens() + failureTokens() + planTokens();

  function evict({ targetTokens }) {
    if (!Number.isFinite(targetTokens) || targetTokens < 0) throw new Error('code_context_target_invalid');
    const evicted = [];

    // 1. Fichiers non épinglés à faible pertinence.
    for (const [path, file] of [...files.entries()].sort((a, b) => a[1].relevance - b[1].relevance)) {
      if (totalTokens() <= targetTokens) break;
      if (file.pinned || file.relevance >= LOW_RELEVANCE) continue;
      files.delete(path);
      evicted.push(`file:${path}`);
    }
    // 2. Actions anciennes (> OLD_ACTION_CYCLES cycles).
    if (totalTokens() > targetTokens) {
      const kept = [];
      for (const entry of actions) {
        if (totalTokens() > targetTokens && cycle - entry.cycle > OLD_ACTION_CYCLES) {
          evicted.push(`action:${entry.action}`);
        } else kept.push(entry);
      }
      actions = kept;
    }
    // 3. Échecs de test anciens ET résolus (les derniers résultats restent toujours).
    if (totalTokens() > targetTokens && testFailures.length > 1) {
      const last = testFailures[testFailures.length - 1];
      const kept = testFailures.filter((entry) => (
        entry === last || cycle - entry.cycle <= OLD_PASSED_TEST_CYCLES
      ));
      for (const entry of testFailures) {
        if (!kept.includes(entry)) evicted.push(`test:${entry.test}`);
      }
      testFailures = kept;
    }
    // 4. Dernier recours : fichiers non épinglés restants, par pertinence croissante.
    for (const [path, file] of [...files.entries()].sort((a, b) => a[1].relevance - b[1].relevance)) {
      if (totalTokens() <= targetTokens) break;
      if (file.pinned) continue;
      files.delete(path);
      evicted.push(`file:${path}`);
    }
    return evicted;
  }

  return Object.freeze({
    addFile({ path, content, relevance = 0.5 } = {}) {
      if (typeof path !== 'string' || path.length === 0) throw new Error('code_context_path_required');
      if (typeof content !== 'string') throw new Error('code_context_content_required');
      const previous = files.get(path);
      files.set(path, {
        content,
        relevance: Math.min(1, Math.max(0, Number(relevance) || 0)),
        pinned: previous?.pinned === true,
      });
    },

    addActionResult({ action, result, observation } = {}) {
      cycle += 1;
      const text = [
        `action=${action ?? 'inconnue'}`,
        result !== undefined ? `résultat=${JSON.stringify(result)}` : null,
        observation !== undefined ? `observation=${String(observation).slice(0, 2_000)}` : null,
      ].filter(Boolean).join(' ');
      actions.push({ action: String(action ?? 'inconnue'), text, cycle });
    },

    addTestFailure({ test, error } = {}) {
      const text = `test=${test ?? 'inconnu'} erreur=${String(error ?? '').slice(0, 4_000)}`;
      testFailures.push({ test: String(test ?? 'inconnu'), text, cycle });
    },

    setActivePlan(plan) { activePlan = plan ?? null; },

    pinFiles(paths) {
      if (!Array.isArray(paths)) throw new Error('code_context_paths_required');
      for (const path of paths) {
        const file = files.get(path);
        if (file) file.pinned = true;
      }
    },

    estimateTokens: () => totalTokens(),

    evict,

    compact() {
      const tokensBefore = totalTokens();
      const evicted = tokensBefore > budget ? evict({ targetTokens: budget }) : [];
      return Object.freeze({ evicted, tokensBefore, tokensAfter: totalTokens(), budget });
    },

    summarizeHistory() {
      const lines = actions.slice(-OLD_ACTION_CYCLES).map((entry) => `- ${entry.text}`);
      const failures = testFailures.slice(-3).map((entry) => `- ${entry.text}`);
      return [
        `Historique (${actions.length} actions, cycle ${cycle}) :`,
        ...lines,
        ...(failures.length > 0 ? ['Échecs de test récents :', ...failures] : []),
      ].join('\n');
    },

    snapshot() {
      return Object.freeze({
        files: [...files.entries()].map(([path, file]) => ({ path, relevance: file.relevance, pinned: file.pinned })),
        actions: actions.length,
        testFailures: testFailures.length,
        cycle,
        tokens: totalTokens(),
      });
    },
  });
}
