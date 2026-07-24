// Registre de LEÇONS — la couche « éviter de répéter » au-dessus du self-model (qui, lui, se
// contente de « se souvenir »). Une leçon = { signature, motif, mitigation } dérivée d'un échec
// RÉEL, appliquée avant la prochaine opération semblable (pré-vol).
//
// Décisions Nasro (plan « apprendre de ses erreurs ») :
//   L1 = mixte  : les leçons TECHNIQUES (dérivées d'un code d'échec) sont actives d'office ;
//                 les COMPORTEMENTALES sont proposées puis confirmées par Nasro.
//   L2 = missions + actions (la signature normalise l'opération, quelle que soit la source).
//   L3 = TTL + réactivation : une leçon passe en veille après N succès sans rechute, expire après
//        un long silence, mais TOUTE nouvelle occurrence la réveille et remet le compteur à zéro.
//   L4 = coffre chiffré : ce module est PUR (Map en mémoire + serialize/hydrate) ; la persistance
//        chiffrée est branchée par l'appelant (même clé dérivée que le journal couche 2).
//
// Garde-fous (non négociables) :
//   • une leçon ne CRÉE jamais un privilège : elle avertit / restreint, jamais elle n'autorise ;
//   • aucun texte libre auto-écrit non vérifié : motif/mitigation sont bornés et, pour les leçons
//     techniques, dérivés déterministement de la FAMILLE du code d'échec — pas d'hallucination.

const MAX_TEXT = 200;
const bounded = (value) => String(value ?? '').replace(/\s+/gu, ' ').trim().slice(0, MAX_TEXT);
const SIGNATURE = /^[a-z0-9]+(?::[a-z0-9_]+){1,3}$/u;

// Mitigation dérivée de la FAMILLE du code (suffixe), jamais d'un code exact supposé. Une leçon
// n'ajoute jamais de capacité : chaque mitigation ne fait que ralentir, rerouter ou re-vérifier.
function mitigationForCode(code) {
  const c = String(code ?? '').toLowerCase();
  if (/(timeout|timed_out|deadline)/u.test(c)) return 'Déjà échoué par dépassement de délai ici : augmenter la patience ou réessayer plus tard, ne pas marteler.';
  if (/(unavailable|unreachable|offline|econnrefused|enotfound)/u.test(c)) return 'Ressource déjà indisponible ici : préférer une voie alternative (autre provider/canal) avant de retenter.';
  if (/(refused|denied|forbidden|unauthorized|locked)/u.test(c)) return 'Déjà refusé ici : exiger une confirmation explicite et vérifier les autorisations avant de retenter.';
  if (/(mismatch|invalid|schema|parse|malformed)/u.test(c)) return 'Déjà invalidé ici : re-vérifier la forme/la source de la donnée avant d’agir (ne pas supposer).';
  if (/(rate|quota|too_many|throttle)/u.test(c)) return 'Déjà limité en débit ici : espacer les tentatives et respecter les quotas.';
  return 'Déjà échoué sur cette opération : avancer prudemment et vérifier le résultat de chaque étape.';
}

export function createLessonsRegistry({
  now = Date.now,
  ttlMs = 30 * 86_400_000,       // silence toléré avant expiration d'une leçon
  dormantAfterSuccesses = 3,     // succès consécutifs sans rechute → mise en veille
  maxLessons = 200,
} = {}) {
  const lessons = new Map(); // signature → leçon

  const isExpired = (lesson, nowMs) => nowMs - lesson.lastSeenAt > ttlMs;
  const isDormant = (lesson) => lesson.confirmed && lesson.successStreak >= dormantAfterSuccesses;

  function prune(nowMs) {
    for (const [sig, lesson] of lessons) if (isExpired(lesson, nowMs)) lessons.delete(sig);
    if (lessons.size > maxLessons) {
      // Éviction des plus anciennement revues d'abord (borne dure, jamais silencieuse côté appelant).
      const ordered = [...lessons.entries()].sort((a, b) => a[1].lastSeenAt - b[1].lastSeenAt);
      for (const [sig] of ordered.slice(0, lessons.size - maxLessons)) lessons.delete(sig);
    }
  }

  function upsertFailure({ signature, motif, mitigation, origin, confirmed }, nowMs) {
    const existing = lessons.get(signature);
    if (existing) {
      // RÉACTIVATION (L3) : une rechute réveille la leçon et remet le compteur de succès à zéro.
      const revived = Object.freeze({
        ...existing,
        occurrences: existing.occurrences + 1,
        successStreak: 0,
        lastSeenAt: nowMs,
        mitigation: mitigation ?? existing.mitigation,
      });
      lessons.set(signature, revived);
      return revived;
    }
    const lesson = Object.freeze({
      signature, motif, mitigation, origin,
      confirmed, occurrences: 1, successStreak: 0,
      firstSeenAt: nowMs, lastSeenAt: nowMs,
    });
    lessons.set(signature, lesson);
    prune(nowMs);
    return lesson;
  }

  return Object.freeze({
    // Échec technique RÉEL → leçon dérivée déterministe, active d'office (L1 : technique = auto).
    learnFromFailure({ scope, code, motif } = {}) {
      const s = String(scope ?? '').toLowerCase().replace(/[^a-z0-9_]/gu, '');
      const c = String(code ?? '').toLowerCase().replace(/[^a-z0-9_]/gu, '');
      if (!s || !c) throw new TypeError('lesson_failure_invalid');
      const signature = `${s}:${c}`;
      if (!SIGNATURE.test(signature)) throw new TypeError('lesson_signature_invalid');
      return upsertFailure({
        signature,
        motif: bounded(motif) || `Échec ${s} (${c}).`,
        mitigation: mitigationForCode(c),
        origin: 'technical',
        confirmed: true,
      }, now());
    },

    // Leçon COMPORTEMENTALE : proposée, INACTIVE tant que Nasro ne l'a pas confirmée (L1 : mixte).
    proposeBehavioral({ signature, motif, mitigation } = {}) {
      const sig = String(signature ?? '').toLowerCase();
      if (!SIGNATURE.test(sig)) throw new TypeError('lesson_signature_invalid');
      if (lessons.has(sig)) return lessons.get(sig);
      const lesson = Object.freeze({
        signature: sig, motif: bounded(motif), mitigation: bounded(mitigation),
        origin: 'behavioral', confirmed: false, occurrences: 1, successStreak: 0,
        firstSeenAt: now(), lastSeenAt: now(),
      });
      lessons.set(sig, lesson);
      prune(now());
      return lesson;
    },

    confirm(signature) {
      const lesson = lessons.get(signature);
      if (!lesson || lesson.confirmed) return Boolean(lesson);
      lessons.set(signature, Object.freeze({ ...lesson, confirmed: true, lastSeenAt: now() }));
      return true;
    },

    // Retrait explicite (transparence : Nasro peut oublier une leçon, comme la mémoire).
    forget(signature) { return lessons.delete(signature); },

    // Ferme la boucle : une opération réussie APRÈS application de la leçon incrémente le compteur ;
    // après N succès la leçon se met en veille (mais reste réactivable).
    recordSuccess(signature) {
      const lesson = lessons.get(signature);
      if (!lesson || !lesson.confirmed) return;
      lessons.set(signature, Object.freeze({ ...lesson, successStreak: lesson.successStreak + 1 }));
    },

    // PRÉ-VOL : avant une opération, l'appelant interroge par signature. Retourne l'avertissement à
    // injecter (motif + mitigation) SI une leçon confirmée est active (non expirée, non en veille),
    // sinon null. N'applique JAMAIS d'effet : c'est un avertissement, pas une autorisation.
    preflight(signature, nowMs = now()) {
      const lesson = lessons.get(signature);
      if (!lesson || !lesson.confirmed || isExpired(lesson, nowMs) || isDormant(lesson)) return null;
      return Object.freeze({
        signature, motif: lesson.motif, mitigation: lesson.mitigation,
        occurrences: lesson.occurrences, origin: lesson.origin,
      });
    },

    list(nowMs = now()) {
      return Object.freeze([...lessons.values()]
        .filter((lesson) => !isExpired(lesson, nowMs))
        .map((lesson) => Object.freeze({
          ...lesson,
          active: lesson.confirmed && !isDormant(lesson),
          dormant: isDormant(lesson),
        })));
    },

    // Persistance chiffrée (L4) : l'appelant sérialise vers le coffre et hydrate au déverrouillage.
    serialize() { return JSON.stringify({ version: 1, lessons: [...lessons.values()] }); },
    hydrate(json) {
      lessons.clear();
      let data;
      try { data = JSON.parse(json); } catch { return false; }
      if (data?.version !== 1 || !Array.isArray(data.lessons)) return false;
      for (const lesson of data.lessons) {
        if (SIGNATURE.test(lesson?.signature ?? '')) lessons.set(lesson.signature, Object.freeze(lesson));
      }
      return true;
    },
  });
}

export { mitigationForCode };

// Brief injectable : les leçons ACTIVES deviennent des rappels courts, injectés à côté du self-brief
// (« déjà échoué ici, fais Y »). Borné : les plus récurrentes d'abord, jamais plus de `max`, pour ne
// pas noyer le contexte. N'AUTORISE rien — ce sont des avertissements.
export function composeLessonsBrief(activeLessons = [], { max = 4 } = {}) {
  const usable = (Array.isArray(activeLessons) ? activeLessons : [])
    .filter((lesson) => lesson?.active && lesson?.mitigation)
    .sort((a, b) => (b.occurrences ?? 0) - (a.occurrences ?? 0))
    .slice(0, max)
    .map((lesson) => `${lesson.motif ? `${lesson.motif} ` : ''}→ ${lesson.mitigation}`);
  return usable.length ? `Leçons à respecter : ${usable.join(' ; ')}.` : '';
}
