// Mina's self-description, composed from the REAL runtime state — never a hardcoded skill list.
// The snapshot is provided by the main process (installed skills, sandbox probe, phone detection);
// this module only turns facts into French sentences, so honesty is structural: an empty skills
// array can only ever produce "aucun skill installé".

const SANDBOX_REASONS = Object.freeze({
  windows_sandbox_feature_disabled: 'fonctionnalité Windows désactivée',
  windows_sandbox_executable_missing: 'exécutable introuvable',
  virtualization_unavailable: 'virtualisation indisponible',
  sandbox_workspace_not_ntfs: 'espace de travail non NTFS',
  sandbox_runtimes_unavailable: 'runtimes non installés',
});

// Kept deliberately tight: this brief is READ ALOUD. Measured against the real API, ~942 chars
// produced ~54 seconds of speech — long enough that the owner talks over it (or mic echo trips
// barge-in) and hears nothing useful. Short, dense sentences beat an exhaustive recitation.
const CORE_LINES = [
  'Je pilote navigateur, bureau et toute application ; missions à la voix, analyse de code, PDF et Word.',
  "Musique, thème, caméra ; interrompez-moi quand vous voulez.",
];

function skillsSentence(skills) {
  if (!Array.isArray(skills) || skills.length === 0) return "Je n'ai encore aucun skill installé.";
  return `Mes skills installés : ${skills.join(', ')}.`;
}

function bundledSkillsSentence(skills) {
  if (!Array.isArray(skills) || skills.length === 0) return "Je n'ai aucun skill intégré détecté.";
  return `Skills intégrés : ${skills.join(', ')}.`;
}

// Verb agreement carried per-label so a plural label never produces "Mes contacts Google est…".
function integrationSentence({ label, plural = false }, state) {
  const is = plural ? 'sont' : 'est';
  if (state?.operational === true) return `${label} ${is} opérationnel${plural ? 's' : ''}.`;
  if (state?.configured === true) return `${label} ${is} configuré${plural ? 's' : ''} mais pas encore opérationnel${plural ? 's' : ''}.`;
  if (state?.implemented === true) return `${label} ${is} intégré${plural ? 's' : ''} mais pas encore configuré${plural ? 's' : ''}.`;
  return `${label} n'${is === 'sont' ? 'e sont' : 'est'} pas disponible${plural ? 's' : ''}.`;
}

// Every integration that is merely "built but not connected yet" collapses into ONE sentence —
// repeating "X est intégré mais pas encore configuré" per service was the bulk of the old 54s brief.
function integrationSentences(entries) {
  const notConfigured = entries.filter(([, state]) => state?.implemented === true && state?.configured !== true);
  const rest = entries.filter((entry) => !notConfigured.includes(entry));
  const sentences = rest
    .filter(([, state]) => state && (state.implemented === true || state.configured === true || state.operational === true))
    .map(([descriptor, state]) => integrationSentence(descriptor, state));
  if (notConfigured.length > 0) {
    sentences.push(`Pas encore configurés : ${notConfigured.map(([descriptor]) => descriptor.shortLabel).join(', ')}.`);
  }
  return sentences;
}

function sandboxSentence(sandbox) {
  if (sandbox?.available === true) return 'Mon bac à sable est disponible.';
  const reason = SANDBOX_REASONS[sandbox?.reason] ?? 'pas encore prêt';
  return `Mon bac à sable est indisponible : ${reason}.`;
}

function phoneSentence(phone) {
  if (phone?.connected === true) return `Votre téléphone ${phone.model || 'Android'} est connecté : caméra et SMS.`;
  return "Votre téléphone n'est pas détecté.";
}

function memorySentence(memoryUnlocked) {
  return memoryUnlocked === true ? 'Ma mémoire chiffrée est ouverte.' : "Ma mémoire chiffrée est verrouillée.";
}

const INTEGRATION_LABELS = Object.freeze({
  mail: { label: 'Mon e-mail', shortLabel: 'e-mail', plural: false },
  googleTasks: { label: 'Google Tasks', shortLabel: 'Google Tasks', plural: false },
  googleCalendar: { label: 'Google Agenda', shortLabel: 'Google Agenda', plural: false },
  googleContacts: { label: 'Mes contacts Google', shortLabel: 'contacts Google', plural: true },
});

export function composeCapabilityBrief(snapshot = {}) {
  const integrations = integrationSentences(
    Object.entries(INTEGRATION_LABELS).map(([key, descriptor]) => [descriptor, snapshot[key]]),
  );
  return [
    'Voici ce que je sais vraiment faire, Patron.',
    ...CORE_LINES,
    skillsSentence(snapshot.skills),
    bundledSkillsSentence(snapshot.bundledSkills),
    sandboxSentence(snapshot.sandbox),
    phoneSentence(snapshot.phone),
    ...integrations,
    memorySentence(snapshot.memoryUnlocked),
  ].join(' ');
}

// Compact factual block appended to the live system instruction so the voice model answers ANY
// state question ("t'as quoi comme skills ?", "le sandbox marche ?") with the truth of the moment.
export function composeInstructionState(snapshot = {}) {
  const skills = Array.isArray(snapshot.skills) && snapshot.skills.length > 0
    ? snapshot.skills.join(', ')
    : 'aucun';
  const sandbox = snapshot.sandbox?.available === true
    ? 'disponible'
    : `indisponible (${SANDBOX_REASONS[snapshot.sandbox?.reason] ?? 'pas prêt'})`;
  const phone = snapshot.phone?.connected === true
    ? `connecté (${snapshot.phone.model || 'Android'})`
    : 'non détecté';
  const bundledSkills = Array.isArray(snapshot.bundledSkills) && snapshot.bundledSkills.length > 0
    ? snapshot.bundledSkills.join(', ')
    : 'aucun';
  const integrationState = (state) => state?.operational === true
    ? 'opérationnel'
    : state?.configured === true ? 'configuré, non opérationnel' : state?.implemented === true ? 'non configuré' : 'absent';
  return [
    `État réel actuel — skills installés : ${skills} ; skills intégrés : ${bundledSkills} ; bac à sable (sandbox) : ${sandbox} ;`,
    `téléphone Android : ${phone} ; mémoire chiffrée : ${snapshot.memoryUnlocked === true ? 'déverrouillée' : 'verrouillée'}.`,
    `E-mail : ${integrationState(snapshot.mail)} ; Google Tasks : ${integrationState(snapshot.googleTasks)} ;`,
    `Google Agenda : ${integrationState(snapshot.googleCalendar)} ; contacts Google : ${integrationState(snapshot.googleContacts)}.`,
    'Capacités permanentes : missions navigateur/bureau/téléphone (ouverture de n\'importe quelle application Windows incluse) ;',
    'analyse de code (indexation, recherche, git, tests, revue) ; génération de documents PDF et Word ;',
    'journal d\'activité et analyse des erreurs techniques avec explication et remède.',
    'Quand on te demande ton état ou tes capacités, appuie-toi uniquement sur ces faits.',
  ].join(' ');
}
