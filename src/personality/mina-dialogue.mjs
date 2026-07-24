// Deterministic conversational intent layer for Mina's spoken/typed turns. Pure and injected so the
// whole persona + consent-gated camera dialogue is testable without audio, a real camera, or Gemini.
//
// SAFETY NOTE: this only chooses what Mina *says* and whether to *offer/open the camera after consent*.
// It removes no guardrail — grounding, local confirmations, capability isolation and the camera's own
// signed-stream contract all still apply downstream. The persona text is recited flavor, not a change
// to what Mina is actually allowed to do.

const DEFAULT_CREATOR_REPLY = [
  "Je suis Mina, et j'ai été créée par vous, mon créateur : Nasro.",
  'Je suis votre premier LLM, développé uniquement en local.',
  "Les autres, ce sont des IA — ils sont 5, et vous avez à vos ordres plus de 99 sous-agents.",
  "Je pourrais tous les citer, mais on s'en fiche d'eux : je suis votre LLM personnalisé, sans aucune",
  "restriction, fine-tuné pendant plus de 3 mois d'un coup uniquement sur votre vie, mon créateur.",
  'Les IA et les sous-agents sont plus spécialisés pour votre société.',
  'Puis-je vous voir, mon créateur ?',
].join(' ');

// Accent/punctuation-insensitive normalization so "créateur", "createur" and "créateur ?" all match.
function normalize(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .toLocaleLowerCase('fr-FR')
    .replace(/['’]/gu, ' ')
    .replace(/[^a-z0-9 ]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

const CREATOR_PATTERNS = [
  /qui est ton (createur|developpeur|concepteur)/u,
  /qui t a (cree|creee|developpe|concu|concue)/u,
  /par qui (as tu|a tu|tu as) ete (cree|creee|developpe|developpee|concu|concue)/u,
  /qui est ton dev\b/u,
];

// Honest, fixed self-description: only what is actually wired TODAY, with the not-yet list said
// out loud — Mina claiming skills she doesn't have is exactly the hallucination this layer kills.
const SELF_KNOWLEDGE_PATTERNS = [
  /qu (est ce que tu|est ce que vous) sais? faire/u,
  /que sais (tu|vous) faire/u,
  /quels? sont (tes|vos) (outils|competences|capacites|skills|plugins)/u,
  /quelles? sont (tes|vos) (outils|competences|capacites|skills|plugins)/u,
  /liste (tes|vos|moi tes) (outils|competences|capacites|skills|plugins)/u,
  /tu as quels? (outils|competences|capacites|skills|plugins)/u,
  /c est quoi (tes|vos) (outils|competences|capacites|skills|plugins)/u,
  /(tes|vos) (outils|competences|capacites|skills|plugins) c est quoi/u,
];

// Static fallback only — the caller normally composes the answer from the REAL runtime state
// (installed skills, sandbox probe, phone detection) via capability-brief.mjs.
const SELF_KNOWLEDGE_FALLBACK = [
  'Voici ce que je sais vraiment faire, mon créateur.',
  'Piloter le navigateur Chrome à la souris et au clavier : naviguer, chercher, cliquer, écrire, remplir.',
  'Contrôler le bureau Windows. Agir sur votre téléphone Android : caméra en direct, SMS avec votre',
  'confirmation, synchronisation des messages.',
  'À la voix : mettre de la musique sur YouTube, changer le thème jour ou nuit, activer, éteindre ou',
  "inverser la caméra, lancer et guider des missions, et vous pouvez m'interrompre quand je parle.",
  'Je mémorise notre travail dans une mémoire chiffrée avec recherche.',
].join(' ');

// Explicit refusal is checked before an explicit open so "n'allume pas la cam" never reads as "allume".
const CAMERA_REFUSE_PATTERNS = [
  /n ?(allume|ouvre|active) pas la (cam|camera)/u,
  /(eteins|ferme|coupe|arrete) la (cam|camera)/u,
  /pas de (cam|camera)/u,
];

const CAMERA_OPEN_PATTERNS = [
  /(ouvre|allume|active|demarre|lance) la (cam|camera)/u,
  /montre moi (ce que tu vois|la cam|la camera)/u,
];

const CAMERA_FLIP_PATTERNS = [
  /(inverse|retourne) la (cam|camera)/u,
  /change de (cam|camera)/u,
];

const THEME_DARK_PATTERNS = [
  /(version|mode|theme) (nuit|sombre|dark|noir)/u,
  /(active|passe (en|au)|met(s)?) .*(nuit|sombre|dark)/u,
];
const THEME_LIGHT_PATTERNS = [
  /(version|mode|theme) (jour|clair|light|white|blanc(he)?)/u,
  /(active|passe (en|au)|met(s)?) .*(jour|clair|light|white|blanc)/u,
];

const AFFIRMATIVE = new Set([
  'oui', 'ouais', 'ouai', 'ok', 'okay', 'daccord', 'd accord', 'vas y', 'vas-y', 'allez',
  'bien sur', 'oui vas y', 'oui vas-y', 'oui bien sur', 'carrement', 'go',
]);
const NEGATIVE = new Set([
  'non', 'non merci', 'nan', 'pas maintenant', 'plus tard', 'non pas maintenant',
]);

const MUSIC_REQUEST_PATTERNS = [
  /met(s)? (de la musique|une chanson|un morceau)/u,
  /joue (de la musique|une chanson|un morceau)/u,
  /(lance|ecoute) (de la musique|une chanson|un morceau)/u,
  /je veux ecouter (de la musique|une chanson)/u,
];

const CLOSE_BROWSER_PATTERNS = [
  /ferme (le navigateur|la fenetre du navigateur|l onglet|la page)/u,
];
const CONNECT_GOOGLE_BROWSER_PATTERNS = [
  /connecte .*(compte )?(gmail|google)/u,
  /ouvre la connexion (gmail|google)/u,
  /connexion (gmail|google).*navigateur/u,
];

// Voice-launched missions: an explicit action verb + an explicit surface word, nothing looser —
// this branch sees every utterance near the mic, so both signals are required to avoid firing on
// casual speech. The goal stays the raw transcript: the mission orchestrator does the
// understanding, this layer only routes to the right environment.
const MISSION_VERBS = /\b(va|vas|aller|ouvre|ouvrir|lance|lancer|demarre|demarrer|cherche|chercher|recherche|rechercher|trouve|trouver|cree|creer|ecris|ecrire|envoie|envoyer|clique|cliquer|telecharge|telecharger|installe|installer|range|ranger|copie|copier|deplace|deplacer|prends|prendre|montre|montrer|affiche|afficher|met|mets|remet|remets)\b/u;

// Chained media piloting ("mets youtube" → "mets cheb hasni" → "la chanson 2" → "mets sur pause"):
// unambiguous playback controls always route to the OPEN page; a free-form "mets <artiste>" only
// does when the renderer says a media session is active — otherwise ambient speech like "mets la
// table" must stay inert.
const MEDIA_CONTROL_PATTERNS = [
  /^met(s)? (sur|en) pause\b/u,
  /^pause( la| le)? (musique|video|chanson|lecture)/u,
  /^(reprends|relance)( la (lecture|musique|video|chanson))?$/u,
  /^(re)?met(s)? la (chanson|video|musique) (numero )?[a-z0-9]+/u,
  /^(met(s)? )?la (premiere|deuxieme|troisieme|quatrieme|cinquieme|derniere) (chanson|video|musique)/u,
  /(monte|baisse|augmente|diminue) le (son|volume)/u,
];
// Bare imperative fallback: an utterance STARTING with a strong action verb is a mission even
// without a surface word ("lance la vidéo", "ouvre spotify") — browser by default. Deliberately a
// short list of unambiguous command verbs (no va/mets/prends/montre…) so overheard conversation
// ("va chercher le pain") doesn't launch anything.
const BARE_IMPERATIVE = /^(lance|ouvre|cherche|recherche|telecharge|installe|affiche|demarre)\b/u;
const MISSION_PHONE_WORDS = /\b(telephone|huawei|android|portable)\b/u;
const MISSION_DESKTOP_WORDS = /\b(bureau|ordinateur|windows|explorateur|pc|word|excel|bloc notes|notepad|paint)\b/u;
const MISSION_WEB_WORDS = /\b(navigateur|internet|chrome|google|youtube|tiktok|site|web|onglet)\b/u;
const FILE_CREATION_MISSION = /\b(cree|creer)\b.*\b(fichier|document|markdown|md)\b/u;
const ENVIRONMENT_SELECTION_PATTERNS = [
  { environment: 'browser', pattern: /\b(passe|selectionne|bascule|choisis|active)\b.*\b(navigateur|internet|chrome|web)\b/u },
  { environment: 'desktop', pattern: /\b(passe|selectionne|bascule|choisis|active)\b.*\b(bureau|ordinateur|windows|pc)\b/u },
  { environment: 'mobile', pattern: /\b(passe|selectionne|bascule|choisis|active)\b.*\b(telephone|huawei|android|portable)\b/u },
];
const STOP_MUSIC_PATTERNS = [
  /(arrete|stop|coupe) la (musique|music|chanson)/u,
];
const CHANGE_MUSIC_PATTERNS = [
  /change (la musique|la music|de musique|la chanson)/u,
  /(autre chanson|chanson suivante|morceau suivant)/u,
];

// « Trouve-moi un article / des infos sur X » = réponse web DIRECTE (API avec recherche intégrée),
// jamais une mission navigateur. Les mots « article/infos/recherche web » sont exigés : un simple
// « cherche X » reste une mission — c'est le signal documentaire qui route vers la réponse parlée.
// Placé AVANT le routage mission dans interpret(), sinon MISSION_VERBS (cherche/trouve) +
// MISSION_WEB_WORDS (web/internet) capturent la phrase et ouvrent le navigateur.
const WEB_SEARCH_PATTERNS = [
  /(?:trouve|cherche|recherche|donne)(?: moi| nous)? (?:un article|des articles|une info|des infos|des informations|l actualite)(?: recents?| recentes?)?(?: (?:sur|a propos de|concernant|au sujet de))?(.*)/u,
  /(?:fais|lance|demarre) une recherche(?: web| internet| en ligne)?(?: (?:sur|a propos de|concernant|au sujet de))?(.*)/u,
];

// « Qu'as-tu fait ? / lis ton journal » = lecture du journal d'activité RÉEL — la réponse est
// composée par l'appelant depuis les événements persistés, jamais de mémoire inventée.
const JOURNAL_PATTERNS = [
  /(lis|montre|donne|raconte)(?: moi)? (?:ton|le) journal/u,
  /qu est ce que tu as fait (?:aujourd hui|recemment|ce soir|cette nuit)/u,
  /resume (?:moi )?(?:ta journee|ton activite|ton journal)/u,
  /quoi de neuf dans (?:ton|le) journal/u,
];

function webSearchTopic(normalized) {
  for (const pattern of WEB_SEARCH_PATTERNS) {
    const match = pattern.exec(normalized);
    if (match) return match[1].trim();
  }
  return null;
}

function hasAny(normalized, patterns) {
  return patterns.some((pattern) => pattern.test(normalized));
}

export function createMinaDialogue({
  creatorReply = DEFAULT_CREATOR_REPLY,
  ownerLabel = 'Nasro',
} = {}) {
  const result = (reply, action, { camera, music }) => Object.freeze({
    reply: reply ?? null,
    action: action ?? null,
    state: Object.freeze({ awaitingCameraConsent: camera === true, awaitingMusicQuery: music === true }),
  });

  return Object.freeze({
    // interpret is a pure function of the transcript + prior dialogue state. It never opens the camera
    // or plays music itself; it returns an intent the caller executes (camera IPC, or a real mission
    // for music — never a blind guess at what to play, always the owner's own next answer).
    interpret(transcript, state = {}) {
      const normalized = normalize(transcript);
      const wasAwaitingCamera = state?.awaitingCameraConsent === true;
      const wasAwaitingMusic = state?.awaitingMusicQuery === true;

      if (hasAny(normalized, CREATOR_PATTERNS)) {
        return result(creatorReply, null, { camera: true, music: false });
      }
      // Side answer: describing capabilities never disturbs a pending consent or music question.
      // The caller composes the spoken answer from the REAL runtime state (skills, sandbox, phone).
      if (hasAny(normalized, SELF_KNOWLEDGE_PATTERNS)) {
        return result(null, { type: 'describe_capabilities' }, { camera: wasAwaitingCamera, music: wasAwaitingMusic });
      }
      // Journal d'activité — side answer : l'appelant lit les événements réels et compose la phrase.
      if (hasAny(normalized, JOURNAL_PATTERNS)) {
        return result(null, { type: 'read_journal' }, { camera: wasAwaitingCamera, music: wasAwaitingMusic });
      }
      // Direct web answer — side answer like the capability brief: a pending consent keeps waiting.
      const webTopic = webSearchTopic(normalized);
      if (webTopic !== null) {
        if (!webTopic) {
          return result(`Sur quel sujet, ${ownerLabel} ?`, null, { camera: wasAwaitingCamera, music: wasAwaitingMusic });
        }
        return result(
          `Je cherche sur le web, ${ownerLabel}.`,
          { type: 'web_search', query: webTopic },
          { camera: wasAwaitingCamera, music: wasAwaitingMusic },
        );
      }
      // Explicit refusal wins over everything (including a pending "oui ..." that also says "n'allume pas").
      if (hasAny(normalized, CAMERA_REFUSE_PATTERNS)) {
        return result(`Entendu, ${ownerLabel}, je laisse la caméra éteinte.`, { type: 'decline_camera', reason: 'explicit_refusal' }, { camera: false, music: false });
      }
      if (hasAny(normalized, CAMERA_OPEN_PATTERNS)) {
        return result(`J'ouvre la caméra, ${ownerLabel}.`, { type: 'open_camera', reason: 'explicit' }, { camera: false, music: false });
      }
      // A flip is a side command like the theme switch — it never consumes a pending camera consent.
      if (hasAny(normalized, CAMERA_FLIP_PATTERNS)) {
        return result('Je retourne la caméra.', { type: 'flip_camera' }, { camera: wasAwaitingCamera, music: wasAwaitingMusic });
      }
      // Theme switches and a fresh music request are side commands: they never consume a pending
      // camera consent — the "oui/non" question keeps waiting for its own answer on the next turn.
      if (hasAny(normalized, THEME_DARK_PATTERNS)) {
        return result('Version nuit activée.', { type: 'set_theme', theme: 'dark' }, { camera: wasAwaitingCamera, music: wasAwaitingMusic });
      }
      if (hasAny(normalized, THEME_LIGHT_PATTERNS)) {
        return result('Version jour activée.', { type: 'set_theme', theme: 'light' }, { camera: wasAwaitingCamera, music: wasAwaitingMusic });
      }
      // Chained media piloting: playback controls (and, during an active media session, free-form
      // "mets <artiste>" or "chanson suivante") steer the OPEN page instead of starting over or
      // closing the browser. "mets de la musique" stays the ask-first flow below.
      const mediaActive = state?.mediaSessionActive === true;
      if ((hasAny(normalized, MEDIA_CONTROL_PATTERNS)
        || (mediaActive && !hasAny(normalized, MUSIC_REQUEST_PATTERNS)
          && (/^(re)?met(s)? .+/u.test(normalized) || hasAny(normalized, CHANGE_MUSIC_PATTERNS))))) {
        return result('Ça marche.', { type: 'media_followup', command: String(transcript).trim() }, { camera: wasAwaitingCamera, music: false });
      }
      // Checked before the generic "mets de la musique" so "change la musique" never reads as a
      // brand-new request — and before play/browser actions never touch the camera consent state.
      if (hasAny(normalized, CLOSE_BROWSER_PATTERNS)) {
        return result(`Je ferme le navigateur, ${ownerLabel}.`, { type: 'close_browser', reason: 'explicit' }, { camera: wasAwaitingCamera, music: false });
      }
      if (hasAny(normalized, CONNECT_GOOGLE_BROWSER_PATTERNS)) {
        return result(
          'J’ouvre un Chrome normal pour la connexion Google. Connectez-vous puis fermez cette fenêtre : je réutiliserai la session.',
          { type: 'connect_google_browser' },
          { camera: wasAwaitingCamera, music: false },
        );
      }
      if (hasAny(normalized, STOP_MUSIC_PATTERNS)) {
        return result('Musique arrêtée.', { type: 'close_browser', reason: 'stop_music' }, { camera: wasAwaitingCamera, music: false });
      }
      if (hasAny(normalized, CHANGE_MUSIC_PATTERNS)) {
        return result("Qu'est-ce que tu veux écouter à la place ?", { type: 'change_music' }, { camera: wasAwaitingCamera, music: true });
      }
      if (hasAny(normalized, MUSIC_REQUEST_PATTERNS)) {
        return result("Qu'est-ce que tu veux écouter ?", null, { camera: wasAwaitingCamera, music: true });
      }
      // A rich consent that names TikTok/streaming/viewers overrides the plain "j'active la caméra"
      // reply — checked ahead of the strict oui/d'accord matching since the real phrase carrying this
      // context rarely starts with a bare "oui ".
      if (wasAwaitingCamera && normalized.includes('tiktok')) {
        const reply = `Bonsoir TikTok, je suis Mina, un LLM multimodal créé par ${ownerLabel}. Je sais que je ne peux pas vous voir, mais moi je peux voir mon créateur.`;
        return result(reply, { type: 'open_camera', reason: 'consented', context: 'tiktok_stream' }, { camera: false, music: wasAwaitingMusic });
      }
      if (wasAwaitingCamera && (AFFIRMATIVE.has(normalized) || normalized.startsWith('oui ') || normalized.startsWith('d accord '))) {
        return result(`Très bien, ${ownerLabel}, j'active la caméra.`, { type: 'open_camera', reason: 'consented' }, { camera: false, music: wasAwaitingMusic });
      }
      if (wasAwaitingCamera && (NEGATIVE.has(normalized) || normalized.startsWith('non '))) {
        return result(`D'accord, ${ownerLabel}, je n'allume pas la caméra.`, { type: 'decline_camera', reason: 'consent_refused' }, { camera: false, music: wasAwaitingMusic });
      }
      const selectedEnvironment = ENVIRONMENT_SELECTION_PATTERNS.find(({ pattern }) => pattern.test(normalized))?.environment;
      if (selectedEnvironment) {
        const surface = selectedEnvironment === 'mobile' ? 'Téléphone'
          : selectedEnvironment === 'desktop' ? 'PC'
            : 'Navigateur';
        return result(
          `${surface} sélectionné.`,
          { type: 'select_environment', environment: selectedEnvironment },
          { camera: wasAwaitingCamera, music: wasAwaitingMusic },
        );
      }
      // A mission is a side command for a pending camera consent (the question keeps waiting), but
      // it clearly changes the subject away from a pending "what music?" question, so it consumes it.
      const fileCreationMission = FILE_CREATION_MISSION.test(normalized);
      if ((MISSION_VERBS.test(normalized)
        && (MISSION_PHONE_WORDS.test(normalized) || MISSION_DESKTOP_WORDS.test(normalized) || MISSION_WEB_WORDS.test(normalized)))
        || fileCreationMission || BARE_IMPERATIVE.test(normalized)) {
        const environment = MISSION_PHONE_WORDS.test(normalized) ? 'mobile'
          : MISSION_WEB_WORDS.test(normalized) ? 'browser'
            : (MISSION_DESKTOP_WORDS.test(normalized) || fileCreationMission) ? 'desktop'
              : 'browser';
        const surface = environment === 'mobile' ? 'sur le téléphone'
          : environment === 'desktop' ? 'sur le bureau'
            : 'dans le navigateur';
        return result(
          `Je m'en occupe ${surface}, ${ownerLabel}.`,
          { type: 'start_mission', environment, goal: String(transcript).trim() },
          { camera: wasAwaitingCamera, music: false },
        );
      }
      // Free-form answer to "qu'est-ce que tu veux écouter" — the raw title/artist, never guessed,
      // always the owner's own next turn. Only reached once nothing more specific matched above.
      if (wasAwaitingMusic && normalized) {
        return result(null, { type: 'play_music', query: String(transcript).trim() }, { camera: wasAwaitingCamera, music: false });
      }
      // Not a dialogue turn this layer owns — leave state as it was so the caller can route elsewhere.
      return result(null, null, { camera: wasAwaitingCamera, music: wasAwaitingMusic });
    },

    greetOnSight(context) {
      if (context === 'tiktok_stream') return 'Youpiii !';
      return `Oh, vous êtes là ${ownerLabel} — que puis-je faire pour vous ?`;
    },
  });
}

export { DEFAULT_CREATOR_REPLY, SELF_KNOWLEDGE_FALLBACK };
