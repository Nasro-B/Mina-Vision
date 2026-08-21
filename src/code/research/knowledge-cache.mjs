// Recherche T2.3 (SPEC agente-codage V2) : mémoire datée de ce que Mina a APPRIS (version de X, API de Y).
// Provenance OBLIGATOIRE (jamais un fait sans source) ; chaque entrée EXPIRE (rien n'est présenté comme
// éternel) ; « d'où tu sais ça ? » → source + date. Sur cache vide/expiré, réponse HONNÊTE : « je dois le
// vérifier », jamais une invention. Module PUR/injectable (horloge injectée pour tester l'expiration).

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export function createKnowledgeCache({ now = () => Date.now(), ttlMs = DEFAULT_TTL_MS } = {}) {
  const store = new Map();

  function remember(key, { value, source } = {}) {
    const k = String(key ?? '').trim();
    if (!k) throw new TypeError('knowledge_key_required');
    if (value === undefined || value === null || value === '') throw new TypeError('knowledge_value_required');
    if (!source || typeof source !== 'string') throw new TypeError('knowledge_source_required'); // provenance obligatoire
    store.set(k, { value, source, at: now(), date: new Date(now()).toISOString() });
    return true;
  }

  function recall(key) {
    const entry = store.get(String(key ?? '').trim());
    if (!entry) return null;
    if (now() - entry.at >= ttlMs) return null; // expiré : jamais servi comme actuel
    return Object.freeze({ value: entry.value, source: entry.source, date: entry.date });
  }

  function explain(key) {
    const entry = recall(key);
    if (!entry) return `Je ne sais pas « ${key} » de source sûre (rien en cache ou expiré) — je dois le vérifier avant de répondre.`;
    return `Je sais que « ${key} » = « ${entry.value} ». Source : ${entry.source}, le ${entry.date}.`;
  }

  return Object.freeze({ remember, recall, explain, size: () => store.size });
}
