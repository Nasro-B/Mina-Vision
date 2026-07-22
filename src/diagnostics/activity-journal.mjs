// Journal d'activité PERSISTANT de Mina Vision — un fichier JSONL par jour, borné, expurgé des
// secrets. C'est la mémoire factuelle de « ce qui s'est réellement passé » : missions, actions,
// bascules de moteur, erreurs, crashs. Mina le LIT (outil vocal lire_journal) — toute affirmation
// sur le passé doit venir d'ici ou du journal d'erreurs, jamais d'une invention.

import { createHash } from 'node:crypto';

const DAY_MS = 86_400_000;
const MAX_ENTRY_BYTES = 4_000;
const MAX_READ_LIMIT = 100;
const RETENTION_DAYS = 7;

// Task 5 (R-04/R-05) : aucun texte utilisateur (transcript vocal, prompt, réponse, corps de
// message) ne touche le disque en clair. La couche 1 (JSONL) ne garde que charCount + digest ;
// le texte intégral part vers la couche 2 chiffrée (sensitive-journal-store) quand elle est
// branchée — la « règle de vérité sur le passé » reste entière une fois le coffre déverrouillé.
const SENSITIVE_TEXT_FIELDS = new Set(['text', 'transcript', 'utterance', 'prompt', 'response', 'content', 'body']);
const SANITIZE_MAX_DEPTH = 4;

export function sanitizeJournalPayload(kind, payload) {
  const collected = [];
  const strip = (value, depth) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || depth > SANITIZE_MAX_DEPTH) return value;
    let changed = false;
    const output = {};
    for (const [key, entry] of Object.entries(value)) {
      if (SENSITIVE_TEXT_FIELDS.has(key) && typeof entry === 'string' && entry.length > 0) {
        collected.push(entry);
        changed = true;
        continue;
      }
      const stripped = strip(entry, depth + 1);
      if (stripped !== entry) changed = true;
      output[key] = stripped;
    }
    return changed ? output : value;
  };
  const sanitizedBase = strip(payload ?? {}, 0);
  if (!collected.length) {
    return { sanitized: sanitizedBase, sensitiveText: null, digest: null, charCount: 0 };
  }
  const sensitiveText = collected.join('\n');
  const digest = `sha256:${createHash('sha256').update(sensitiveText, 'utf8').digest('hex')}`;
  const charCount = collected.reduce((total, part) => total + part.length, 0);
  return {
    sanitized: { ...(sanitizedBase && typeof sanitizedBase === 'object' ? sanitizedBase : {}), charCount, digest },
    sensitiveText,
    digest,
    charCount,
  };
}

// Mêmes motifs que le journal technique : aucune valeur de secret ne doit toucher le disque.
const redactSecrets = (value) => String(value ?? '')
  .replace(/(Bearer|Token)\s+[A-Za-z0-9._~+/-]+=*/giu, '$1 [REDACTED]')
  .replace(/\b(AIza|sk-|gsk_|hf_|xai-|ghp_)[A-Za-z0-9_-]{8,}/gu, '[REDACTED]')
  .replace(/\b([A-Za-z0-9_]*(?:key|token|secret|password|passphrase)[A-Za-z0-9_]*)\s*[=:]\s*[^\s,;"']{4,}/giu, '$1=[REDACTED]');

const dayStamp = (ms) => new Date(ms).toISOString().slice(0, 10);

export function createActivityJournal({
  directory,
  appendFile,
  readFile,
  readdir,
  rm,
  mkdir,
  now = Date.now,
  retentionDays = RETENTION_DAYS,
  // Couche 2 optionnelle : reçoit { at, kind, digest, text } pour chaque texte expurgé de la
  // couche 1. Même contrat fire-and-forget que le journal lui-même.
  sensitiveSink = null,
} = {}) {
  if (!directory || typeof appendFile !== 'function' || typeof readFile !== 'function'
    || typeof readdir !== 'function' || typeof rm !== 'function' || typeof mkdir !== 'function') {
    throw new TypeError('activity_journal_dependencies_required');
  }
  const filenameFor = (ms) => `${directory}/activity-${dayStamp(ms)}.jsonl`;
  let ready = null;
  const ensureDirectory = () => {
    ready ??= mkdir(directory, { recursive: true }).catch(() => {});
    return ready;
  };
  // Écritures séquencées : deux append simultanés ne peuvent pas entrelacer leurs lignes.
  let writing = Promise.resolve();

  function serialize(kind, payload) {
    const entry = { at: now(), kind: String(kind ?? 'event').slice(0, 60) };
    try {
      const body = redactSecrets(JSON.stringify(payload ?? {}));
      entry.payload = body.length > MAX_ENTRY_BYTES ? `${body.slice(0, MAX_ENTRY_BYTES)}…[tronqué]` : body;
    } catch {
      entry.payload = '"[non_serialisable]"';
    }
    return `${JSON.stringify(entry)}\n`;
  }

  return Object.freeze({
    // Fire-and-forget assumé : journaliser ne doit JAMAIS ralentir ni casser l'app.
    append(kind, payload) {
      const { sanitized, sensitiveText, digest } = sanitizeJournalPayload(kind, payload);
      const line = serialize(kind, sanitized);
      if (sensitiveText && sensitiveSink) {
        try {
          void sensitiveSink.store({ at: now(), kind: String(kind ?? 'event'), digest, text: sensitiveText });
        } catch { /* la couche 2 ne casse jamais la couche 1 */ }
      }
      writing = writing
        .then(() => ensureDirectory())
        .then(() => appendFile(filenameFor(now()), line, 'utf8'))
        .catch(() => {});
      return writing;
    },

    // Les N derniers événements, du plus récent au plus ancien, sur aujourd'hui + hier (une
    // question vocale porte sur le passé proche ; l'archive reste lisible sur disque).
    async read({ limit = 30, kinds = null } = {}) {
      const bounded = Math.max(1, Math.min(Number(limit) || 30, MAX_READ_LIMIT));
      const wanted = Array.isArray(kinds) && kinds.length > 0 ? new Set(kinds) : null;
      const at = now();
      const entries = [];
      for (const ms of [at, at - DAY_MS]) {
        const content = await readFile(filenameFor(ms), 'utf8').catch(() => '');
        for (const line of content.split('\n')) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            if (wanted && !wanted.has(parsed.kind)) continue;
            let payload;
            try { payload = JSON.parse(parsed.payload); } catch { payload = parsed.payload; }
            entries.push(Object.freeze({ at: parsed.at, kind: parsed.kind, payload }));
          } catch { /* ligne corrompue (arrêt brutal en pleine écriture) : ignorée, jamais fatale */ }
        }
      }
      return Object.freeze(entries.sort((a, b) => b.at - a.at).slice(0, bounded));
    },

    // Purge au démarrage : au-delà de la rétention, les fichiers partent — le journal est un
    // outil de diagnostic, pas une archive infinie sur le disque.
    async purge() {
      const names = await readdir(directory).catch(() => []);
      const cutoff = dayStamp(now() - retentionDays * DAY_MS);
      let removed = 0;
      for (const name of names) {
        const match = /^activity-(\d{4}-\d{2}-\d{2})\.jsonl$/u.exec(name);
        if (!match || match[1] >= cutoff) continue;
        await rm(`${directory}/${name}`).catch(() => {});
        removed += 1;
      }
      return { removed };
    },
  });
}

// Résumé parlable pour la couche vocale déterministe (mode Deepgram sans function calling).
export function composeJournalBrief(entries = []) {
  if (!entries.length) return "Mon journal d'activité est vide pour aujourd'hui.";
  const labels = {
    mission_started: 'mission lancée',
    mission_completed: 'mission terminée',
    mission_error: 'mission en erreur',
    action_error: 'action en erreur',
    voice_engine: 'bascule vocale',
    crash: 'incident interne',
  };
  const counts = new Map();
  for (const entry of entries) {
    const label = labels[entry.kind] ?? entry.kind;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const summary = [...counts.entries()].map(([label, count]) => `${count} ${label}`).join(', ');
  return `Journal récent : ${summary}. Dernier événement : ${entries[0].kind}.`;
}
