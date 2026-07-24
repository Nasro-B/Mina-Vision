// Catalogue de capacités (amélioration A) : sépare TROIS natures d'information que le snapshot
// runtime mélangeait — readiness (prête à agir maintenant ?), health (états dégradés à montrer),
// capabilities (ce que Mina SAIT faire, stable tant que le code ne change pas). Composé depuis le
// MÊME snapshot réel que le brief vocal : jamais une liste codée en dur, jamais un état inventé.

const PERMANENT_CAPABILITIES = Object.freeze([
  Object.freeze({ id: 'missions_browser', label: 'Missions navigateur (Computer Use)' }),
  Object.freeze({ id: 'missions_desktop', label: 'Missions bureau Windows — toute application (launch_app inclus)' }),
  Object.freeze({ id: 'missions_mobile', label: 'Missions téléphone Android (ADB)' }),
  Object.freeze({ id: 'voice', label: 'Voix temps réel (Gemini Live, repli Deepgram + TTS local)' }),
  Object.freeze({ id: 'code', label: 'Analyse de code : indexation, recherche, git, tests, revue' }),
  Object.freeze({ id: 'documents', label: 'Génération de documents PDF et Word' }),
  Object.freeze({ id: 'memory', label: 'Mémoire chiffrée locale avec phrase de récupération' }),
  Object.freeze({ id: 'journal', label: 'Journal d\'activité (double couche, texte chiffré) et analyse des erreurs' }),
  Object.freeze({ id: 'skills', label: 'Skills audités et installés sous confirmation' }),
]);

function integrationHealth(key, state) {
  if (state?.operational === true) return null;
  if (state?.configured === true) return { id: key, level: 'degraded', detail: 'configuré mais pas opérationnel' };
  if (state?.implemented === true) return { id: key, level: 'not_configured', detail: 'intégré mais pas configuré' };
  return null;
}

export function composeCapabilityCatalog(snapshot = {}, { budgets = null } = {}) {
  const readiness = Object.freeze({
    memoryUnlocked: snapshot.memoryUnlocked === true,
    phoneConnected: snapshot.phone?.connected === true,
    sandboxAvailable: snapshot.sandbox?.available === true,
    // Prête pour une mission = le cœur l'est toujours quand l'app tourne ; les canaux dégradés
    // sont listés dans health, ils n'empêchent pas d'agir localement.
    missionReady: true,
  });

  const health = [];
  if (snapshot.sandbox?.available !== true) {
    health.push({ id: 'sandbox', level: 'unavailable', detail: snapshot.sandbox?.reason ?? 'indisponible' });
  }
  if (snapshot.phone?.connected !== true) {
    health.push({ id: 'phone', level: 'disconnected', detail: 'téléphone non détecté' });
  }
  if (snapshot.memoryUnlocked !== true) {
    health.push({ id: 'memory', level: 'locked', detail: 'mémoire chiffrée verrouillée' });
  }
  for (const key of ['mail', 'googleTasks', 'googleCalendar', 'googleContacts']) {
    const issue = integrationHealth(key, snapshot[key]);
    if (issue) health.push(issue);
  }

  const capabilities = Object.freeze({
    permanent: PERMANENT_CAPABILITIES,
    skills: Object.freeze([...(Array.isArray(snapshot.skills) ? snapshot.skills : [])]),
    bundledSkills: Object.freeze([...(Array.isArray(snapshot.bundledSkills) ? snapshot.bundledSkills : [])]),
    // Conscience COMPLÈTE : la liste réelle des outils vocaux (fonctions appelables) et les
    // paramètres NON SENSIBLES actifs, pour que Mina sache exactement ce qu'elle peut faire et
    // comment elle est réglée. Les valeurs viennent de la vue safe de la config (aucun secret).
    tools: Object.freeze((Array.isArray(snapshot.tools) ? snapshot.tools : [])
      .filter((tool) => tool && typeof tool.name === 'string')
      .map((tool) => Object.freeze({ name: tool.name, description: String(tool.description ?? '') }))),
  });

  return Object.freeze({
    readiness,
    health: Object.freeze(health.map((issue) => Object.freeze(issue))),
    capabilities,
    ...(snapshot.settings ? { settings: Object.freeze({ ...snapshot.settings }) } : {}),
    ...(budgets ? { budgets } : {}),
    composedAt: Date.now(),
  });
}
