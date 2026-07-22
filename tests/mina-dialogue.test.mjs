import { describe, expect, it } from 'vitest';
import { createMinaDialogue } from '../src/personality/mina-dialogue.mjs';

function fresh() {
  return createMinaDialogue();
}

describe('createMinaDialogue: creator / developer identity', () => {
  it.each([
    'qui est ton créateur',
    'Qui est ton createur ?',
    'qui est ton développeur',
    'par qui as-tu été développé',
    'par qui as tu ete developpe ?',
    "qui t'a créé",
    'qui t’a developpé',
  ])('answers "%s" with the fixed persona reply and then awaits camera consent', (transcript) => {
    const dialogue = fresh();
    const result = dialogue.interpret(transcript, {});
    expect(result.reply).toContain('Nasro');
    expect(result.reply).toContain('premier LLM');
    expect(result.reply).toContain('mon créateur');
    expect(result.action).toBeNull();
    expect(result.state.awaitingCameraConsent).toBe(true);
  });

  it('lets the persona text be overridden while still setting the consent state', () => {
    const dialogue = createMinaDialogue({ creatorReply: 'Réponse sur mesure, mon créateur.' });
    const result = dialogue.interpret('qui est ton créateur', {});
    expect(result.reply).toBe('Réponse sur mesure, mon créateur.');
    expect(result.state.awaitingCameraConsent).toBe(true);
  });
});

describe('createMinaDialogue: consent-gated camera after the creator question', () => {
  it.each(['oui', 'ok', "d'accord", 'daccord', 'vas-y', 'bien sûr', 'oui vas-y'])(
    'opens the camera on affirmative "%s" while consent is pending',
    (transcript) => {
      const dialogue = fresh();
      const result = dialogue.interpret(transcript, { awaitingCameraConsent: true });
      expect(result.action).toEqual({ type: 'open_camera', reason: 'consented' });
      expect(result.state.awaitingCameraConsent).toBe(false);
    },
  );

  it.each(['non', 'non merci', 'pas maintenant'])(
    'refuses to open the camera on negative "%s" while consent is pending',
    (transcript) => {
      const dialogue = fresh();
      const result = dialogue.interpret(transcript, { awaitingCameraConsent: true });
      expect(result.action).toEqual({ type: 'decline_camera', reason: 'consent_refused' });
      expect(result.state.awaitingCameraConsent).toBe(false);
    },
  );

  it('treats a bare "oui" with no pending consent as nothing to act on', () => {
    const dialogue = fresh();
    const result = dialogue.interpret('oui', {});
    expect(result.action).toBeNull();
    expect(result.reply).toBeNull();
  });
});

describe('createMinaDialogue: explicit camera commands regardless of consent state', () => {
  it.each(['ouvre la cam', 'ouvre la caméra', 'allume la caméra', 'active la cam'])(
    'opens the camera on explicit "%s"',
    (transcript) => {
      const dialogue = fresh();
      const result = dialogue.interpret(transcript, {});
      expect(result.action).toEqual({ type: 'open_camera', reason: 'explicit' });
    },
  );

  it.each(["n'allume pas la caméra", 'nallume pas la cam', "n'ouvre pas la cam", 'éteins la caméra', 'ferme la cam'])(
    'refuses on explicit "%s"',
    (transcript) => {
      const dialogue = fresh();
      const result = dialogue.interpret(transcript, {});
      expect(result.action).toEqual({ type: 'decline_camera', reason: 'explicit_refusal' });
    },
  );

  it('prioritizes an explicit refusal over a pending consent (a plain "non n\'allume pas")', () => {
    const dialogue = fresh();
    const result = dialogue.interpret("non n'allume pas la caméra", { awaitingCameraConsent: true });
    expect(result.action).toEqual({ type: 'decline_camera', reason: 'explicit_refusal' });
    expect(result.state.awaitingCameraConsent).toBe(false);
  });

  it.each(['inverse la cam', 'inverse la caméra', 'retourne la cam', 'change de caméra'])(
    'flips the camera lens on "%s"', (transcript) => {
      const dialogue = fresh();
      const result = dialogue.interpret(transcript, {});
      expect(result.action).toEqual({ type: 'flip_camera' });
    },
  );

  it('flipping the camera never touches a pending camera consent', () => {
    const dialogue = fresh();
    const result = dialogue.interpret('inverse la cam', { awaitingCameraConsent: true });
    expect(result.action).toEqual({ type: 'flip_camera' });
    expect(result.state.awaitingCameraConsent).toBe(true);
  });
});

describe('createMinaDialogue: consent with a TikTok-stream context (face hidden, viewers present)', () => {
  it('opens the camera with a TikTok greeting when the consent explicitly mentions TikTok', () => {
    const dialogue = fresh();
    const result = dialogue.interpret(
      "d'accord tu peux lancer la cam mais je vais pas montrer mon visage car nous avons des spectateurs, nous sommes en live sur tiktok",
      { awaitingCameraConsent: true },
    );
    expect(result.action).toEqual({ type: 'open_camera', reason: 'consented', context: 'tiktok_stream' });
    expect(result.reply).toContain('Bonsoir TikTok');
    expect(result.reply).toContain('Nasro');
    expect(result.state.awaitingCameraConsent).toBe(false);
  });

  it('falls back to the plain consent reply when TikTok is not mentioned', () => {
    const dialogue = fresh();
    const result = dialogue.interpret('oui', { awaitingCameraConsent: true });
    expect(result.action).toEqual({ type: 'open_camera', reason: 'consented' });
    expect(result.reply).not.toContain('TikTok');
  });

  it('greets with "youpiii" on sight when the camera was opened in TikTok-stream context', () => {
    const dialogue = fresh();
    expect(dialogue.greetOnSight('tiktok_stream')).toBe('Youpiii !');
  });

  it('keeps the plain greeting on sight otherwise', () => {
    const dialogue = fresh();
    expect(dialogue.greetOnSight()).toContain('vous êtes là');
  });
});

describe('createMinaDialogue: greeting after Mina sees the owner', () => {
  it('produces the "oh vous êtes là" greeting on demand', () => {
    const dialogue = fresh();
    expect(dialogue.greetOnSight()).toContain('vous êtes là');
    expect(dialogue.greetOnSight()).toContain('Nasro');
  });
});

describe('createMinaDialogue: unrelated input is left untouched', () => {
  it('returns no reply and no action for anything it does not recognize', () => {
    const dialogue = fresh();
    const result = dialogue.interpret('quelle heure est-il', { awaitingCameraConsent: false });
    expect(result.reply).toBeNull();
    expect(result.action).toBeNull();
    expect(result.state.awaitingCameraConsent).toBe(false);
  });
});

describe('createMinaDialogue: day/night theme switch by voice', () => {
  it.each(['je veux la version nuit', 'active la version nuit', 'mode nuit', 'thème sombre', 'passe en dark'])(
    'switches to dark on "%s"',
    (transcript) => {
      const dialogue = fresh();
      const result = dialogue.interpret(transcript, {});
      expect(result.action).toEqual({ type: 'set_theme', theme: 'dark' });
    },
  );

  it.each(['je veux la version jour', 'je veux la version white', 'mode jour', 'thème clair', 'passe en light', 'mode blanc'])(
    'switches to light on "%s"',
    (transcript) => {
      const dialogue = fresh();
      const result = dialogue.interpret(transcript, {});
      expect(result.action).toEqual({ type: 'set_theme', theme: 'light' });
    },
  );

  it('does not clear a pending camera consent when it is an unrelated theme command', () => {
    const dialogue = fresh();
    const result = dialogue.interpret('version nuit', { awaitingCameraConsent: true });
    expect(result.action).toEqual({ type: 'set_theme', theme: 'dark' });
    expect(result.state.awaitingCameraConsent).toBe(true);
  });
});

describe('createMinaDialogue: music request is a two-turn exchange, never a blind guess', () => {
  it.each(['mets de la musique', 'met de la musique', 'joue de la musique', 'mets une chanson', "je veux écouter de la musique"])(
    'asks what to play on "%s" instead of guessing, and never touches camera consent state', (transcript) => {
      const dialogue = fresh();
      const result = dialogue.interpret(transcript, { awaitingCameraConsent: true });
      expect(result.reply).toContain('écouter');
      expect(result.action).toBeNull();
      expect(result.state.awaitingMusicQuery).toBe(true);
      expect(result.state.awaitingCameraConsent).toBe(true);
    },
  );

  it('turns the next turn into a play_music action carrying the raw title/artist', () => {
    const dialogue = fresh();
    const result = dialogue.interpret('Bohemian Rhapsody de Queen', { awaitingMusicQuery: true });
    expect(result.action).toEqual({ type: 'play_music', query: 'Bohemian Rhapsody de Queen' });
    expect(result.state.awaitingMusicQuery).toBe(false);
  });

  it('does not treat an answer as a music query when nothing was asked', () => {
    const dialogue = fresh();
    const result = dialogue.interpret('Bohemian Rhapsody de Queen', {});
    expect(result.action).toBeNull();
    expect(result.reply).toBeNull();
  });

  it('an explicit command (e.g. camera) during a pending music question still wins over the raw-query fallback', () => {
    const dialogue = fresh();
    const result = dialogue.interpret('ouvre la cam', { awaitingMusicQuery: true });
    expect(result.action).toEqual({ type: 'open_camera', reason: 'explicit' });
    expect(result.state.awaitingMusicQuery).toBe(false);
  });
});

describe('createMinaDialogue: closing the browser / stopping / changing music', () => {
  it.each(['connecte mon compte gmail', 'ouvre la connexion Google', 'connexion gmail dans le navigateur'])(
    'opens the dedicated normal Chrome authentication flow on "%s"', (transcript) => {
      const dialogue = fresh();
      const result = dialogue.interpret(transcript, {});
      expect(result.action).toEqual({ type: 'connect_google_browser' });
    },
  );

  it.each(['ferme le navigateur', 'ferme la fenêtre du navigateur', "ferme l'onglet"])(
    'closes the browser on "%s"', (transcript) => {
      const dialogue = fresh();
      const result = dialogue.interpret(transcript, {});
      expect(result.action).toEqual({ type: 'close_browser', reason: 'explicit' });
    },
  );

  it.each(['arrête la musique', 'arrete la music', 'stop la musique', 'coupe la musique', 'arrête la chanson'])(
    'stops the music (by closing its source, the most verifiable way) on "%s"', (transcript) => {
      const dialogue = fresh();
      const result = dialogue.interpret(transcript, {});
      expect(result.action).toEqual({ type: 'close_browser', reason: 'stop_music' });
    },
  );

  it.each(['change la musique', 'change de musique', 'change la chanson', 'autre chanson', 'chanson suivante'])(
    'closes the current one and re-asks what to play next on "%s"', (transcript) => {
      const dialogue = fresh();
      const result = dialogue.interpret(transcript, {});
      expect(result.action).toEqual({ type: 'change_music' });
      expect(result.reply).toContain('écouter');
      expect(result.state.awaitingMusicQuery).toBe(true);
    },
  );

  it('closing the browser never touches a pending camera consent', () => {
    const dialogue = fresh();
    const result = dialogue.interpret('ferme le navigateur', { awaitingCameraConsent: true });
    expect(result.action).toEqual({ type: 'close_browser', reason: 'explicit' });
    expect(result.state.awaitingCameraConsent).toBe(true);
  });
});

describe('createMinaDialogue: voice-launched missions (browser / desktop / phone)', () => {
  it.each([
    ['passe sur le navigateur', 'browser'],
    ['sélectionne le bureau', 'desktop'],
    ['bascule sur le téléphone', 'mobile'],
  ])('changes the selected surface without launching a mission on "%s"', (transcript, environment) => {
    const dialogue = fresh();
    const result = dialogue.interpret(transcript, {});
    expect(result.action).toEqual({ type: 'select_environment', environment });
    expect(result.reply).toMatch(/s[ée]lectionn[ée]|activ[ée]/iu);
  });

  it.each([
    ['crée un fichier markdown', 'desktop'],
    ['créer un fichier .md sur le PC', 'desktop'],
    ['crée un document texte sur le bureau', 'desktop'],
  ])('routes local file creation to the desktop on "%s"', (transcript, environment) => {
    const dialogue = fresh();
    const result = dialogue.interpret(transcript, {});
    expect(result.action).toMatchObject({ type: 'start_mission', environment, goal: transcript });
  });

  it.each([
    ['va sur youtube', 'browser'],
    ['va sur google et cherche la météo à Alger', 'browser'],
    ['ouvre le navigateur et va sur le site de la SNCF', 'browser'],
    ['ouvre chrome', 'browser'],
    ['cherche la recette du couscous sur internet', 'browser'],
    ['recherche sur google les horaires de prière', 'browser'],
  ])('starts a browser mission on "%s"', (transcript, environment) => {
    const dialogue = fresh();
    const result = dialogue.interpret(transcript, {});
    expect(result.action).toMatchObject({ type: 'start_mission', environment });
    expect(result.action.goal).toBe(transcript);
    expect(result.reply).toContain('navigateur');
  });

  it.each([
    ['ouvre whatsapp sur le téléphone', 'mobile'],
    ['sur le téléphone ouvre les photos', 'mobile'],
    ['va sur youtube sur le huawei', 'mobile'],
    ['prends une photo avec le téléphone', 'mobile'],
  ])('starts a phone mission on "%s"', (transcript, environment) => {
    const dialogue = fresh();
    const result = dialogue.interpret(transcript, {});
    expect(result.action).toMatchObject({ type: 'start_mission', environment });
    expect(result.action.goal).toBe(transcript);
    expect(result.reply).toContain('téléphone');
  });

  it.each([
    ["ouvre l'explorateur de fichiers sur le pc", 'desktop'],
    ['sur le bureau ouvre le bloc-notes', 'desktop'],
    ['lance word sur l’ordinateur', 'desktop'],
  ])('starts a desktop mission on "%s"', (transcript, environment) => {
    const dialogue = fresh();
    const result = dialogue.interpret(transcript, {});
    expect(result.action).toMatchObject({ type: 'start_mission', environment });
    expect(result.action.goal).toBe(transcript);
    expect(result.reply).toContain('bureau');
  });

  it('a mission is a side command: it never consumes a pending camera consent', () => {
    const dialogue = fresh();
    const result = dialogue.interpret('va sur youtube', { awaitingCameraConsent: true });
    expect(result.action).toMatchObject({ type: 'start_mission', environment: 'browser' });
    expect(result.state.awaitingCameraConsent).toBe(true);
  });

  it('specific commands keep winning over the mission patterns', () => {
    const dialogue = fresh();
    expect(dialogue.interpret('ferme le navigateur', {}).action.type).toBe('close_browser');
    expect(dialogue.interpret('active la caméra', {}).action.type).toBe('open_camera');
    expect(dialogue.interpret('mets de la musique', {}).action).toBeNull();
    expect(dialogue.interpret('mets de la musique', {}).state.awaitingMusicQuery).toBe(true);
  });

  it('casual speech still starts nothing at all', () => {
    const dialogue = fresh();
    for (const transcript of ['il fait beau aujourd’hui', 'je suis fatigué ce soir', 'on mange quoi']) {
      const result = dialogue.interpret(transcript, {});
      expect(result.reply).toBeNull();
      expect(result.action).toBeNull();
    }
  });
});

describe('createMinaDialogue: bare imperative fallback (no surface word)', () => {
  it.each([
    'lance la vidéo suivante',
    'ouvre spotify',
    'cherche la recette du couscous',
    'recherche les horaires de la pharmacie',
    'télécharge le document',
    'installe vlc',
    'affiche les résultats',
  ])('starts a browser mission on the bare imperative "%s"', (transcript) => {
    const dialogue = fresh();
    const result = dialogue.interpret(transcript, {});
    expect(result.action).toMatchObject({ type: 'start_mission', environment: 'browser' });
    expect(result.action.goal).toBe(transcript);
  });

  it.each([
    'je vais lancer un truc plus tard',
    'tu pourrais chercher un jour',
    'il faut installer quelque chose',
    'on mange quoi ce soir',
  ])('never fires on non-imperative speech "%s"', (transcript) => {
    const dialogue = fresh();
    const result = dialogue.interpret(transcript, {});
    expect(result.action).toBeNull();
    expect(result.reply).toBeNull();
  });

  it('specific branches still win over the bare imperative', () => {
    const dialogue = fresh();
    expect(dialogue.interpret('ouvre la caméra', {}).action.type).toBe('open_camera');
    expect(dialogue.interpret('lance de la musique', {}).state.awaitingMusicQuery).toBe(true);
    expect(dialogue.interpret('ouvre whatsapp sur le téléphone', {}).action.environment).toBe('mobile');
  });
});

describe('createMinaDialogue: self-knowledge (tools, skills, capabilities)', () => {
  it.each([
    'que sais-tu faire ?',
    "qu'est-ce que tu sais faire",
    'quels sont tes outils',
    'quelles sont tes compétences',
    'liste tes capacités',
    'tu as quels skills',
    "c'est quoi tes plugins",
  ])('turns "%s" into a describe_capabilities action (the caller composes the answer from REAL state)', (transcript) => {
    const dialogue = fresh();
    const result = dialogue.interpret(transcript, {});
    expect(result.action).toEqual({ type: 'describe_capabilities' });
    expect(result.reply).toBeNull();
  });

  it('self-knowledge is a side answer: it never consumes a pending camera consent', () => {
    const dialogue = fresh();
    const result = dialogue.interpret('que sais-tu faire', { awaitingCameraConsent: true });
    expect(result.state.awaitingCameraConsent).toBe(true);
  });

  it('the creator question still wins over self-knowledge phrasing overlap', () => {
    const dialogue = fresh();
    expect(dialogue.interpret('qui est ton créateur', {}).reply).toContain('premier LLM');
  });
});

describe('createMinaDialogue: chained media session (YouTube piloting)', () => {
  it('"mets youtube" starts a browser mission (mets joins the mission verbs)', () => {
    const dialogue = fresh();
    const result = dialogue.interpret('mets youtube', {});
    expect(result.action).toMatchObject({ type: 'start_mission', environment: 'browser' });
  });

  it.each([
    'mets sur pause',
    'mets en pause',
    'pause la musique',
    'reprends la lecture',
    'mets la chanson 2',
    'mets la deuxième chanson',
    'monte le son',
  ])('"%s" is always a media control, even without an active media session', (transcript) => {
    const dialogue = fresh();
    const result = dialogue.interpret(transcript, {});
    expect(result.action).toMatchObject({ type: 'media_followup' });
    expect(result.action.command).toBe(transcript);
  });

  it('with an active media session, a free "mets <artiste>" becomes a media follow-up', () => {
    const dialogue = fresh();
    const result = dialogue.interpret('mets cheb hasni', { mediaSessionActive: true });
    expect(result.action).toMatchObject({ type: 'media_followup', command: 'mets cheb hasni' });
  });

  it('without a media session, a free "mets <quelque chose>" stays inert (ambient speech safety)', () => {
    const dialogue = fresh();
    const result = dialogue.interpret('mets la table pour ce soir', {});
    expect(result.action).toBeNull();
    expect(result.reply).toBeNull();
  });

  it('with an active media session, "chanson suivante" pilots the open page instead of closing the browser', () => {
    const dialogue = fresh();
    const result = dialogue.interpret('chanson suivante', { mediaSessionActive: true });
    expect(result.action).toMatchObject({ type: 'media_followup' });
  });

  it('without a media session, "change la musique" keeps its close-and-ask behavior', () => {
    const dialogue = fresh();
    const result = dialogue.interpret('change la musique', {});
    expect(result.action).toEqual({ type: 'change_music' });
  });

  it('"mets de la musique" keeps the ask-first music flow, never a mission', () => {
    const dialogue = fresh();
    const result = dialogue.interpret('mets de la musique', { mediaSessionActive: true });
    expect(result.action).toBeNull();
    expect(result.state.awaitingMusicQuery).toBe(true);
  });

  it('media follow-ups preserve a pending camera consent', () => {
    const dialogue = fresh();
    const result = dialogue.interpret('mets sur pause', { awaitingCameraConsent: true });
    expect(result.state.awaitingCameraConsent).toBe(true);
  });
});

describe('createMinaDialogue: direct web answer — « trouve-moi un article » without the browser', () => {
  it.each([
    ['trouve-moi un article sur les fusées réutilisables', 'les fusees reutilisables'],
    ['cherche-moi des articles sur la réforme des retraites', 'la reforme des retraites'],
    ['cherche des infos sur le prix du gaz', 'le prix du gaz'],
    ['recherche des informations concernant les robots de massage', 'les robots de massage'],
    ['fais une recherche web sur les meilleures cliniques dentaires', 'les meilleures cliniques dentaires'],
  ])('turns "%s" into a web_search intent with the extracted topic', (transcript, topic) => {
    const result = fresh().interpret(transcript, {});
    expect(result.action).toEqual({ type: 'web_search', query: topic });
    expect(result.reply).toContain('web');
  });

  it('asks for the topic instead of firing an empty search', () => {
    const result = fresh().interpret('trouve-moi un article', {});
    expect(result.action).toBeNull();
    expect(result.reply).toMatch(/sujet/iu);
  });

  it('never hijacks music, navigation missions, or capability questions', () => {
    expect(fresh().interpret('mets cheb hasni', { mediaSessionActive: true }).action?.type).not.toBe('web_search');
    expect(fresh().interpret('va sur youtube et lance une vidéo', {}).action?.type).not.toBe('web_search');
    expect(fresh().interpret('quels sont tes outils', {}).action?.type).toBe('describe_capabilities');
  });

  it('keeps a pending camera consent waiting — a web search is a side answer', () => {
    const result = fresh().interpret('cherche-moi des infos sur les fauteuils dentaires', { awaitingCameraConsent: true });
    expect(result.action?.type).toBe('web_search');
    expect(result.state.awaitingCameraConsent).toBe(true);
  });
});

describe('createMinaDialogue: lecture du journal d activite reel', () => {
  it.each([
    'lis-moi ton journal',
    'raconte-moi ton journal',
    "qu'est-ce que tu as fait aujourd'hui",
    'résume ta journée',
  ])('routes "%s" to the read_journal side answer', (transcript) => {
    const result = fresh().interpret(transcript, {});
    expect(result.action).toEqual({ type: 'read_journal' });
  });

  it('keeps a pending camera consent waiting — journal is a side answer', () => {
    const result = fresh().interpret('lis ton journal', { awaitingCameraConsent: true });
    expect(result.action?.type).toBe('read_journal');
    expect(result.state.awaitingCameraConsent).toBe(true);
  });
});
