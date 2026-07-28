import { applyEnvironmentSelection, computeVoiceStartTime, formatGroundingLabel } from './controller.mjs';
import { createMinaDialogue, SELF_KNOWLEDGE_FALLBACK } from '../personality/mina-dialogue.mjs';
import { composeCapabilityBrief } from '../core/capability-brief.mjs';
import { describeCircle } from '../core/domain-circles.mjs';
import { composeJournalBrief } from '../diagnostics/journal-brief.mjs';
import {
  contactRow, homeDeviceRow, mailAccountRow, mailMessageRow, personalityRow,
  chatDeviceRow, printerRow, renderList, renderUnavailable, routineRow, taskRow,
} from './panels/domain-panels.mjs';
import { assessFrameQuality, decideLensFlip, frameStatsFromGrayscale } from '../perception/frame-quality.mjs';
import {
  cloudzirPaletteColors, createBargeInDetector, createCloudzirPalettePreference,
  createVoiceAnimationPreference, createVoicePresence, isPlaybackSuppressed, isShieldActive,
  nextCloudzirPalette, normalizeVoiceLevel, readbackShieldDuration,
} from './voice-presence.mjs';

const api = window.mina;
const elements = {
  iris: document.querySelector('#iris'),
  voicePresenceCanvas: document.querySelector('#voice-presence-canvas'),
  voicePresence: document.querySelector('#voice-presence'),
  voiceAnimation: document.querySelector('#voice-animation-select'),
  voiceFullscreen: document.querySelector('#voice-fullscreen-button'),
  voicePresenceLabel: document.querySelector('#voice-presence-label'),
  voicePresenceDetail: document.querySelector('#voice-presence-detail'),
  statusDot: document.querySelector('#status-dot'),
  statusText: document.querySelector('#status-text'),
  lockPanel: document.querySelector('#lock-panel'),
  lockText: document.querySelector('#lock-text'),
  goal: document.querySelector('#goal'),
  start: document.querySelector('#start-button'),
  stop: document.querySelector('#stop-button'),
  resume: document.querySelector('#resume-button'),
  voice: document.querySelector('#voice-button'),
  dental: document.querySelector('#dental-button'),
  dentalMode: document.querySelector('#dental-mode'),
  phone: document.querySelector('#phone-button'),
  phoneStatus: document.querySelector('#phone-status'),
  camera: document.querySelector('#camera-button'),
  cameraStatus: document.querySelector('#camera-status'),
  webcamVision: document.querySelector('#webcam-vision-button'),
  webcamVisionStatus: document.querySelector('#webcam-vision-status'),
  visionFile: document.querySelector('#vision-file-button'),
  visionFileStatus: document.querySelector('#vision-file-status'),
  conversationTool: document.querySelector('#conversation-button'),
  conversationStatus: document.querySelector('#conversation-status'),
  cameraPreview: document.querySelector('#camera-preview'),
  cameraSwitch: document.querySelector('#camera-switch-button'),
  workspace: document.querySelector('#workspace'),
  helpButton: document.querySelector('#help-button'),
  themeToggle: document.querySelector('#theme-toggle'),
  themeToggleIcon: document.querySelector('#theme-toggle-icon'),
  toolsToggle: document.querySelector('#tools-toggle'),
  toolsToggleLabel: document.querySelector('#tools-toggle-label'),
  cameraFrame: document.querySelector('#camera-frame'),
  sms: document.querySelector('#sms-button'),
  phoneSync: document.querySelector('#phone-sync-button'),
  settingsSave: document.querySelector('#settings-save'),
  settingsMode: document.querySelector('#settings-mode'),
  settingsOffline: document.querySelector('#settings-offline'),
  settingsFields: document.querySelector('#settings-fields'),
  settingsProviders: document.querySelector('#settings-providers'),
  smsPolicyStatus: document.querySelector('#sms-policy-status'),
  smsPolicyRevoke: document.querySelector('#sms-policy-revoke'),
  smsPolicyReactivate: document.querySelector('#sms-policy-reactivate'),
  analyticsRefresh: document.querySelector('#analytics-refresh'),
  analyticsExportCsv: document.querySelector('#analytics-export-csv'),
  analyticsExportJson: document.querySelector('#analytics-export-json'),
  analyticsFrom: document.querySelector('#analytics-from'),
  analyticsTo: document.querySelector('#analytics-to'),
  analyticsSummary: document.querySelector('#analytics-summary'),
  analyticsResults: document.querySelector('#analytics-results'),
  automationRefresh: document.querySelector('#automation-refresh'),
  automationSummary: document.querySelector('#automation-summary'),
  extensionsRefresh: document.querySelector('#extensions-refresh'),
  extensionsSummary: document.querySelector('#extensions-summary'),
  todayRefresh: document.querySelector('#today-refresh'),
  todayItems: document.querySelector('#today-items'),
  emergencyNetworkState: document.querySelector('#emergency-network-state'),
  log: document.querySelector('#log'),
  technicalLog: document.querySelector('#technical-log'),
  technicalLogClear: document.querySelector('#technical-log-clear'),
  counter: document.querySelector('#counter'),
  memoryRequired: document.querySelector('#memory-required'),
  memoryState: document.querySelector('#memory-state'),
  semanticState: document.querySelector('#semantic-state'),
  backupState: document.querySelector('#backup-state'),
  recoveryPhrase: document.querySelector('#recovery-phrase'),
  recoveryOutput: document.querySelector('#recovery-output'),
  memoryInitialize: document.querySelector('#memory-initialize'),
  memoryUnlock: document.querySelector('#memory-unlock'),
  memoryLock: document.querySelector('#memory-lock'),
  memoryQuery: document.querySelector('#memory-query'),
  memorySearch: document.querySelector('#memory-search'),
  filePath: document.querySelector('#file-path'),
  fileRead: document.querySelector('#file-read'),
  webUrl: document.querySelector('#web-url'),
  webRead: document.querySelector('#web-read'),
  memoryResults: document.querySelector('#memory-results'),
  minaDigest: document.querySelector('#mina-digest'),
  sandboxState: document.querySelector('#sandbox-state'),
  sandboxRemediation: document.querySelector('#sandbox-remediation'),
  chooseSkill: document.querySelector('#choose-skill'),
  installSkill: document.querySelector('#install-skill'),
  quarantineReport: document.querySelector('#quarantine-report'),
  skillList: document.querySelector('#skill-list'),
  sandboxProposals: document.querySelector('#sandbox-proposals'),
  sandboxJobs: document.querySelector('#sandbox-jobs'),
  sandboxArtifacts: document.querySelector('#sandbox-artifacts'),
  sandboxStream: document.querySelector('#sandbox-stream'),
};

const voiceAnimationPreference = createVoiceAnimationPreference({ storage: window.localStorage });
elements.voiceAnimation.value = voiceAnimationPreference.load();
const voicePresence = createVoicePresence({
  canvas: elements.voicePresenceCanvas,
  container: elements.voicePresence,
  label: elements.voicePresenceLabel,
  detail: elements.voicePresenceDetail,
  reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true,
});
voicePresence.setAnimation(elements.voiceAnimation.value);
elements.voiceAnimation.addEventListener('change', () => {
  elements.voiceAnimation.value = voiceAnimationPreference.save(elements.voiceAnimation.value);
  voicePresence.setAnimation(elements.voiceAnimation.value);
});

// CloudZIR colour cycling. Applies ONLY the gradient variables the bars read — the shape lives in
// the CSS keyframes and bar geometry, which nothing here touches.
const cloudzirPalettePreference = createCloudzirPalettePreference({ storage: window.localStorage });
let cloudzirPalette = cloudzirPalettePreference.load();
const applyCloudzirPalette = (id) => {
  const { from, to } = cloudzirPaletteColors(id);
  elements.voicePresence.style.setProperty('--cloudzir-from', from);
  elements.voicePresence.style.setProperty('--cloudzir-to', to);
};
applyCloudzirPalette(cloudzirPalette);
// Click anywhere on the animation surface (windowed or fullscreen) to advance the palette.
elements.voicePresence.addEventListener('click', () => {
  if (elements.voiceAnimation.value !== 'cloudzir') return;
  cloudzirPalette = cloudzirPalettePreference.save(nextCloudzirPalette(cloudzirPalette));
  applyCloudzirPalette(cloudzirPalette);
});

// Fullscreen uses the native API so Échap exits without any custom key handling.
elements.voiceFullscreen.addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await elements.voicePresence.requestFullscreen();
  } catch (error) {
    log(`Plein écran indisponible : ${error.message}`);
  }
});

let actionCount = 0;
let busy = false;
let voiceCapture = null;
let audioPlaybackTime = 0;
let playbackContext = null;
let stagedQuarantineId = null;
let sandboxAvailable = false;
let settingsSchema = null;
let cameraStreaming = false;
let cameraLens = 'front';
let cameraFlipTried = false;
let cameraGreetContext = undefined;
let greetedOnSight = false;
const dialogue = createMinaDialogue();
let dialogueState = { awaitingCameraConsent: false };
// True while a YouTube/music mission is (or just was) driving the browser: lets follow-up voice
// lines ("mets cheb hasni", "la chanson 2", "mets sur pause") pilot the OPEN page instead of dying.
let mediaSessionActive = false;
const qualityProbe = document.createElement('canvas');
qualityProbe.width = 48;
qualityProbe.height = 48;

// Local Windows TTS (Web Speech API) — LAST-RESORT ONLY. Its SAPI timbre is robotic; the natural
// fallback is speakLocal() below (Kokoro), and the normal path remains the Gemini Live voice.
const speakSapi = (text) => {
  try {
    const synth = window.speechSynthesis;
    if (!synth || typeof SpeechSynthesisUtterance !== 'function') return;
    const utterance = new SpeechSynthesisUtterance(String(text).slice(0, 600));
    utterance.lang = 'fr-FR';
    synth.cancel();
    synth.speak(utterance);
  } catch { /* speech is best-effort, never fatal */ }
};

// Natural local fallback voice (Kokoro ff_siwis in a worker process): its PCM chunks arrive on the
// SAME mina:voice-audio channel as Gemini's, so playback, animations and barge-in behave
// identically. SAPI only remains for the case where the local model itself is unavailable.
const speak = (text) => {
  api.localTts({ text: String(text ?? '') })
    .then((result) => { if (!result?.spoken) speakSapi(text); })
    .catch(() => { speakSapi(text); });
};

// One mouth only: deterministic replies are sent back to Gemini Live as "[DIS] <texte>" and read
// verbatim by its natural voice (the local TTS sounded robotic and overlapped with Gemini's own
// audio). Falls back to local TTS only when no live voice session exists to do the reading.
// Timestamp of the last deterministic line handed to the voice model. Used to ignore a barge-in
// that fires in the instant right after: the owner's own question is still echoing (mic picks up
// the tail of their sentence, or the speakers), the server VAD reads that as "user is talking",
// and the reply gets killed before a single word is heard — the exact "elle se tait puis demande
// si j'ai entendu" symptom. A REAL interruption a moment later still works normally.
let lastReadbackAt = 0;
const READBACK_GRACE_MS = 2_000;
// Ignoring the echo interruption client-side is NOT enough: the interruption already killed the
// audio generation SERVER-side, so « Mina continue » had nothing left to play — the owner heard
// silence while Mina believed she had spoken (« et voilà »). The only real recovery is to re-send
// the same [DIS] line once. One retry only: a retry loop against a persistent echo would stutter.
let lastReadbackText = '';
let readbackRetryUsed = false;

// Timestamp of the last barge-in cut. Chunks still in flight from the killed turn are dropped for
// a SHORT self-expiring window (see isPlaybackSuppressed) — an earlier version used a boolean
// cleared only by say(), which silently muted every later conversational reply for good.
let playbackSuppressedAt = 0;
// Dernier chunk audio de la voix PRINCIPALE réellement joué — sert au repli local anti-doublon.
let lastVoiceAudioAt = 0;

// Bouclier de lecture : tant qu'une réplique déterministe est lue, le micro n'alimente PLUS le
// serveur (l'écho des haut-parleurs déclenchait le VAD qui tuait la lecture — « liste tes
// outils » → mute → « et voilà »). Le barge-in réel reste : le détecteur local coupe la lecture
// sur une voix soutenue (~400 ms au-dessus de l'écho résiduel).
let readbackShieldUntil = 0;
const bargeInDetector = createBargeInDetector();

const say = async (text) => {
  lastReadbackAt = Date.now();
  lastReadbackText = text;
  readbackRetryUsed = false;
  playbackSuppressedAt = 0; // a new line to speak re-opens playback immediately after any earlier cut
  readbackShieldUntil = Date.now() + readbackShieldDuration(text);
  bargeInDetector.reset();
  try {
    const result = await api.sayVoice(text);
    if (result?.spoken) return;
    if (result?.reason === 'paused') return; // en pause : silence voulu, jamais de repli local
  } catch { /* fall through to the local fallback voice */ }
  // Anti-doublon (cas réel : la voix LOCALE répétait la phrase APRÈS la voix principale) :
  // l'échec de sendText pendant une reprise de session n'empêche pas toujours Gemini de finir
  // par parler. Le repli local attend 2 s et ne joue QUE si la voix principale n'a rien émis.
  const requestedAt = Date.now();
  setTimeout(() => {
    if (lastVoiceAudioAt > requestedAt || scheduledVoiceSources.size > 0) return;
    speak(text);
  }, 2_000);
};

// Grayscale mean/variance of the current camera frame, read from a downscaled offscreen canvas so the
// black/blurry decision runs cheaply on every frame. Returns null if the frame can't be sampled yet.
const sampleFrameStats = (image) => {
  try {
    const context = qualityProbe.getContext('2d', { willReadFrequently: true });
    if (!context || !image.naturalWidth) return null;
    context.drawImage(image, 0, 0, qualityProbe.width, qualityProbe.height);
    const { data } = context.getImageData(0, 0, qualityProbe.width, qualityProbe.height);
    const gray = new Uint8Array(data.length / 4);
    for (let i = 0, g = 0; i < data.length; i += 4, g += 1) {
      gray[g] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    }
    return frameStatsFromGrayscale(gray);
  } catch {
    return null;
  }
};

const openCameraFromDialogue = async (context) => {
  cameraGreetContext = context;
  if (cameraStreaming) return;
  try {
    await api.startPhoneCamera();
    cameraStreaming = true;
    cameraLens = 'front';
    cameraFlipTried = false;
    greetedOnSight = false;
    elements.cameraStatus.textContent = 'Démarrage CameraX…';
  } catch (error) {
    void reportTechnicalError('camera', 'camera_start_failed', error);
    log(`Caméra : ${error.message}`);
  }
};

const declineCameraFromDialogue = async () => {
  if (!cameraStreaming) return;
  try {
    await api.stopPhoneCamera();
    cameraStreaming = false;
    elements.cameraPreview.hidden = true;
    elements.cameraSwitch.hidden = true;
    elements.cameraFrame.removeAttribute('src');
    elements.cameraStatus.textContent = 'Caméra signée · arrêt sécurisé';
  } catch (error) {
    void reportTechnicalError('camera', 'camera_stop_failed', error);
    log(`Caméra : ${error.message}`);
  }
};

// The dialogue layer only ever returns the owner's own next answer (title/artist) — never a guessed
// song. Turning it into a real mission (not a bespoke YouTube automation) reuses the whole existing
// orchestrator: normalized actions, confirmations, and post-action verification all still apply.
const playMusicFromDialogue = async (query) => {
  const trimmed = String(query ?? '').trim().slice(0, 200);
  if (!trimmed) return;
  mediaSessionActive = true;
  try {
    const results = await api.searchYouTube({ query: trimmed, maxResults: 1 });
    const first = results[0];
    if (!first?.url) throw new Error('youtube_api_empty_results');
    elements.goal.value = `Ouvre exactement ${first.url} dans YouTube et lance la lecture de « ${first.title} » par ${first.channelTitle}.`;
    log(`YouTube Data API : ${first.title} · ${first.channelTitle}`);
  } catch (error) {
    log(`YouTube Data API indisponible (${error.message}) ; recherche navigateur.`);
    elements.goal.value = `Va sur https://www.youtube.com, cherche "${trimmed}" et lance la lecture de la première vidéo pertinente dans les résultats.`;
  }
  void startMission(elements.goal.value, 'browser');
};

const timeLabel = () => new Intl.DateTimeFormat('fr-FR', {
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
}).format(new Date());

const log = (message) => {
  if (elements.log.children.length === 1 && elements.log.textContent.includes('attend une instruction')) {
    elements.log.textContent = '';
  }
  const item = document.createElement('li');
  const time = document.createElement('time');
  const text = document.createElement('span');
  time.textContent = timeLabel();
  text.textContent = String(message);
  item.append(time, text);
  elements.log.prepend(item);
  while (elements.log.children.length > 30) elements.log.lastElementChild.remove();
};

const reportTechnicalError = (scope, code, error, severity = 'error') => api.reportTechnicalError({
  severity,
  scope,
  code,
  message: String(error?.message ?? error ?? 'Erreur technique sans détail.'),
}).catch(() => {});

const technicalLogTime = (occurredAt) => {
  const date = new Date(occurredAt);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(date);
};

const renderTechnicalEntry = (entry) => {
  if (elements.technicalLog.querySelector('.technical-log-empty')) elements.technicalLog.textContent = '';
  const item = document.createElement('li');
  const time = document.createElement('time');
  const text = document.createElement('span');
  item.className = `technical-log-entry ${entry.severity === 'warning' ? 'warning' : 'error'}`;
  time.textContent = technicalLogTime(entry.occurredAt);
  text.textContent = `[${entry.scope}] ${entry.code} — ${entry.message}`;
  item.append(time, text);
  elements.technicalLog.prepend(item);
  while (elements.technicalLog.children.length > 100) elements.technicalLog.lastElementChild.remove();
};

const showEmptyTechnicalLog = () => {
  elements.technicalLog.textContent = '';
  const item = document.createElement('li');
  const time = document.createElement('time');
  const text = document.createElement('span');
  item.className = 'technical-log-empty';
  time.textContent = '—';
  text.textContent = 'Aucune erreur technique.';
  item.append(time, text);
  elements.technicalLog.append(item);
};

const refreshTechnicalLog = async () => {
  const entries = await api.listTechnicalLogs();
  showEmptyTechnicalLog();
  [...entries].reverse().forEach(renderTechnicalEntry);
};

const setStatus = (label, type = 'ready', active = false) => {
  elements.statusText.textContent = label;
  elements.statusDot.className = `status-dot ${type}`;
  elements.iris.classList.toggle('active', active);
  elements.resume.hidden = type !== 'blocked';
};

const setBusy = (value) => {
  busy = value;
  elements.start.disabled = value;
  elements.dental.disabled = value;
  elements.iris.classList.toggle('active', value || Boolean(voiceCapture));
};

const selectedEnvironment = () => document.querySelector('input[name="environment"]:checked')?.value || 'browser';
const selectEnvironment = (environment) => applyEnvironmentSelection(environment,
  document.querySelectorAll('input[name="environment"]'),
);

const startMission = async (goal = elements.goal.value, environment = selectedEnvironment()) => {
  if (busy) return;
  const instruction = String(goal).trim();
  if (!instruction) {
    elements.goal.focus();
    log('Ajoutez une instruction avant de lancer Mina.');
    return;
  }
  setBusy(true);
  setStatus('Mission en cours', 'ready', true);
  log(`Mission lancée sur ${environment} : ${instruction}`);
  try {
    const result = await api.start({
      goal: instruction,
      environment,
      memoryRequired: elements.memoryRequired.checked,
    });
    log(result.status === 'completed' ? `Terminé : ${result.result}` : `Arrêt : ${result.stopReason}`);
    setStatus(result.status === 'completed' ? 'Prête' : 'Mission arrêtée', result.status === 'completed' ? 'ready' : 'blocked');
    // Spoken outcome: in a voice session the owner isn't reading the log — silence after
    // "je m'en occupe" reads as "nothing happened".
    void say(result.status === 'completed' ? 'Mission terminée.' : "Je n'ai pas pu finir la mission.");
  } catch (error) {
    void reportTechnicalError(`mission:${environment}`, 'mission_request_failed', error);
    log(`Erreur : ${error.message}`);
    setStatus('Action bloquée', 'blocked');
    // Cause fréquente et actionnable (journal réel 2026-07-27 : 6 missions mobiles échouées en
    // 90 s sur la même cause) : dire le REMÈDE précis plutôt qu'un échec générique.
    // Formulation écho-inerte (contrat spoken-lines-echo-safe).
    void say(String(error?.message ?? '').includes('déverrouillé et autorisé')
      ? 'Le téléphone est verrouillé ou refuse le débogage. Déverrouille-le, accepte la demande de débogage, puis redemande-moi.'
      : "La mission a échoué, mon créateur.");
  } finally {
    setBusy(false);
  }
};

const downsamplePcm16 = (samples, sourceRate, targetRate = 16_000) => {
  const ratio = sourceRate / targetRate;
  const length = Math.max(1, Math.floor(samples.length / ratio));
  const pcm = new Int16Array(length);
  for (let index = 0; index < length; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(samples.length, Math.floor((index + 1) * ratio));
    let sum = 0;
    for (let cursor = start; cursor < end; cursor += 1) sum += samples[cursor];
    const value = Math.max(-1, Math.min(1, sum / Math.max(1, end - start)));
    pcm[index] = value < 0 ? value * 0x8000 : value * 0x7fff;
  }
  return pcm.buffer;
};

const startVoiceCapture = async () => {
  // Create/resume the PLAYBACK context here, while still inside the click's user-gesture window:
  // an AudioContext first created later (on the first arriving chunk) can be born "suspended" by
  // Chromium's autoplay policy, and then Mina's reply is scheduled but never audible.
  if (!playbackContext) playbackContext = new AudioContext({ sampleRate: 24_000 });
  if (playbackContext.state === 'suspended') await playbackContext.resume().catch(() => {});
  const voiceSession = await api.startVoice();
  if (voiceSession?.engine === 'deepgram') {
    log('Gemini indisponible — écoute de secours Deepgram active, voix locale naturelle.');
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    video: false,
  });
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  const silent = context.createGain();
  silent.gain.value = 0;
  processor.onaudioprocess = (event) => {
    const samples = event.inputBuffer.getChannelData(0);
    voicePresence.setLevel(samples);
    if (isShieldActive({ shieldUntil: readbackShieldUntil, now: Date.now() })) {
      // Lecture en cours : rien ne part au serveur (zéro écho = zéro coupure serveur)…
      if (!bargeInDetector.push(normalizeVoiceLevel(samples))) return;
      // …sauf si le propriétaire parle VRAIMENT : voix soutenue → on coupe la lecture et on
      // rouvre le micro immédiatement, ce chunk inclus — l'interruption reste instantanée.
      readbackShieldUntil = 0;
      log('Vous parlez — je me tais et je vous écoute.');
      stopVoicePlayback();
    }
    api.sendVoiceAudio(downsamplePcm16(samples, context.sampleRate));
  };
  source.connect(processor);
  processor.connect(silent);
  silent.connect(context.destination);
  voiceCapture = { stream, context, source, processor, silent };
  voicePresence.dispatch({ type: 'capture_started' });
  elements.voice.setAttribute('aria-pressed', 'true');
  elements.voice.querySelector('span:last-child').textContent = 'À l’écoute';
  setStatus('À l’écoute', 'ready', true);
  log('Voix active. Dites « Salut Mina », « Bonjour Mina » ou « Mina, comment ça va ? ».');
};

const stopVoiceCapture = async () => {
  if (!voiceCapture) return;
  voiceCapture.processor.disconnect();
  voiceCapture.source.disconnect();
  voiceCapture.silent.disconnect();
  voiceCapture.stream.getTracks().forEach((track) => track.stop());
  await voiceCapture.context.close();
  voiceCapture = null;
  await api.stopVoice();
  voicePresence.dispatch({ type: 'capture_stopped' });
  elements.voice.setAttribute('aria-pressed', 'false');
  elements.voice.querySelector('span:last-child').textContent = 'Live Stream';
  setStatus('Prête', 'ready');
};

// Every scheduled chunk keeps its source referenced so a barge-in can stop the whole queue —
// without this, audio already buffered client-side keeps talking long after the server stopped.
const scheduledVoiceSources = new Set();

const playPcm24 = async (payload) => {
  if (isPlaybackSuppressed({ suppressedAt: playbackSuppressedAt, now: Date.now() })) return;
  lastVoiceAudioAt = Date.now();
  const bytes = payload?.audio instanceof Uint8Array ? payload.audio : new Uint8Array(payload?.audio ?? []);
  if (bytes.byteLength < 2) return;
  if (!playbackContext) playbackContext = new AudioContext({ sampleRate: 24_000 });
  // Chromium starts an AudioContext created outside a direct user gesture in "suspended" state —
  // scheduling then succeeds silently and NOTHING is heard. Resuming is idempotent and cheap.
  if (playbackContext.state === 'suspended') void playbackContext.resume().catch(() => {});
  const pcm = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
  const audioBuffer = playbackContext.createBuffer(1, pcm.length, 24_000);
  const channel = audioBuffer.getChannelData(0);
  for (let index = 0; index < pcm.length; index += 1) channel[index] = pcm[index] / 0x8000;
  const source = playbackContext.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(playbackContext.destination);
  scheduledVoiceSources.add(source);
  source.onended = () => {
    scheduledVoiceSources.delete(source);
    if (scheduledVoiceSources.size === 0 && voiceCapture) {
      voicePresence.dispatch({ type: 'playback_finished' });
      // Lecture réellement terminée : le bouclier estimé ne doit JAMAIS rendre Mina sourde plus
      // longtemps que la vraie voix — 800 ms de marge pour la queue d'écho, puis micro rouvert.
      readbackShieldUntil = Math.min(readbackShieldUntil, Date.now() + 800);
    }
  };
  // Coussin anti-gigue (voir computeVoiceStartTime) : 150 ms au départ d'une salve, recalage
  // à +60 ms pour un chunk en retard — supprime les micro-coupures dues au réseau/IPC.
  const startsAt = computeVoiceStartTime({
    currentTime: playbackContext.currentTime,
    queuedUntil: audioPlaybackTime,
    queueEmpty: scheduledVoiceSources.size === 1, // cette source vient d'être ajoutée au Set
  });
  source.start(startsAt);
  audioPlaybackTime = startsAt + audioBuffer.duration;
};

// Barge-in: the owner spoke over Mina. Cut everything still queued locally (Gemini chunks + the
// fallback TTS) so she goes quiet and listens. The live session and the dialogue state are left
// untouched — the conversation context is never lost, only the remaining speech is dropped.
const stopVoicePlayback = () => {
  playbackSuppressedAt = Date.now();
  readbackShieldUntil = 0; // toute coupure rouvre le micro immédiatement — jamais de surdité résiduelle
  for (const source of scheduledVoiceSources) {
    try { source.stop(); } catch { /* already ended */ }
  }
  scheduledVoiceSources.clear();
  audioPlaybackTime = 0;
  if (voiceCapture) voicePresence.dispatch({ type: 'capture_started' });
  try { window.speechSynthesis?.cancel(); } catch { /* fallback TTS optional */ }
};

const formatDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'date inconnue' : date.toLocaleString('fr-FR');
};

const updateMemoryStatus = (state) => {
  elements.memoryState.textContent = state.locked ? 'Verrouillée' : 'Déverrouillée';
  elements.memoryState.className = state.locked ? 'badge blocked' : 'badge ready';
  elements.semanticState.textContent = state.semanticMode === 'lexical_degraded'
    ? 'RAG lexical dégradé'
    : state.semanticMode;
  elements.semanticState.className = state.semanticMode === 'lexical_degraded' ? 'badge warning' : 'badge';
  elements.backupState.textContent = state.backupState === 'configured' ? 'Firebase configuré' : 'Backup désactivé';
  elements.backupState.className = 'badge';
  elements.memorySearch.disabled = state.locked;
  elements.fileRead.disabled = state.locked;
  elements.webRead.disabled = state.locked;
};

const renderMemoryItems = (items, kind = 'memory') => {
  elements.memoryResults.textContent = '';
  if (!items.length) {
    const empty = document.createElement('li');
    empty.textContent = 'Aucun résultat.';
    elements.memoryResults.append(empty);
    return;
  }
  items.forEach((item) => {
    const row = document.createElement('li');
    const content = document.createElement('strong');
    const meta = document.createElement('small');
    if (kind === 'evidence') {
      content.textContent = item.extract || 'Preuve sans extrait';
      meta.textContent = `${item.locator || 'source inconnue'} · ${formatDate(item.capturedAt)} · ${item.freshnessClass || 'statut inconnu'}`;
    } else {
      content.textContent = item.masked ? 'Contenu sensible masqué' : item.content;
      const provenance = Object.keys(item.provenance ?? {}).length ? JSON.stringify(item.provenance) : 'provenance inconnue';
      meta.textContent = `${formatDate(item.date)} · ${item.classification} · ${provenance}`;
    }
    row.append(content, meta);
    elements.memoryResults.append(row);
  });
};

const refreshMemoryStatus = async () => updateMemoryStatus(await api.memoryStatus());

const settingValue = (key, state) => {
  const providers = state.config.providers;
  const values = {
    LM_STUDIO_ENABLED: providers.lmStudio.enabled,
    LM_STUDIO_BASE_URL: providers.lmStudio.baseUrl,
    LM_STUDIO_TEXT_MODEL: providers.lmStudio.model,
    LM_STUDIO_VISION_MODEL: providers.lmStudio.visionModel,
    LM_STUDIO_EMBEDDING_MODEL: providers.lmStudio.embeddingModel,
    LM_STUDIO_TIMEOUT_MS: providers.lmStudio.timeoutMs,
    GEMINI_MODEL: providers.gemini.model,
    DEEPSEEK_BASE_URL: providers.deepseek.baseUrl,
    DEEPSEEK_MODEL: providers.deepseek.model,
    OPENROUTER_BASE_URL: providers.openrouter.baseUrl,
    OPENROUTER_VISION_MODEL: providers.openrouter.model,
    MODAL_ENDPOINT: providers.modal.baseUrl,
    MODAL_MODEL: providers.modal.model,
    HF_INFERENCE_BASE_URL: providers.huggingface.baseUrl,
    HF_TEXT_MODEL: providers.huggingface.model,
    HTTPSMS_BASE_URL: state.config.sms.httpsms.baseUrl,
    HTTPSMS_FROM_NUMBER: state.config.sms.httpsms.fromNumber,
    HTTPSMS_SMS_MODE: state.config.sms.httpsms.mode,
    SMS_SEND_MODE: state.config.sms.policy.sendMode,
    SMS_ALLOWLIST: state.config.sms.policy.allowlist.join(', '),
    SMS_QUIET_HOURS_START: state.config.sms.policy.quietHoursStart ?? '',
    SMS_QUIET_HOURS_END: state.config.sms.policy.quietHoursEnd ?? '',
    SMS_MAX_PER_MINUTE: state.config.sms.policy.maxPerMinute,
    SMS_MAX_PER_DAY: state.config.sms.policy.maxPerDay,
  };
  return values[key] ?? '';
};

const refreshSettings = async () => {
  const [schema, state] = await Promise.all([api.settingsSchema(), api.settingsState()]);
  settingsSchema = schema;
  elements.settingsMode.textContent = '';
  schema.modes.forEach((mode) => {
    const option = document.createElement('option');
    option.value = mode;
    option.textContent = mode;
    option.selected = mode === state.config.inference.mode;
    elements.settingsMode.append(option);
  });
  elements.settingsOffline.checked = state.config.inference.offline;
  // Libellés HUMAINS : l'utilisateur ne doit jamais voir le nom brut d'une variable (ex.
  // « LM_STUDIO_ENABLED ») comme seul texte. Le nom technique reste affiché en indice discret.
  const SETTINGS_LABELS = {
    LM_STUDIO_ENABLED: { label: 'Activer les modèles locaux (LM Studio)', help: 'Cherche un serveur LM Studio local pour texte, vision et mémoire sémantique.' },
    LM_STUDIO_BASE_URL: { label: 'Adresse du serveur LM Studio', help: 'Loopback + HTTP, ex. http://127.0.0.1:1234/v1.' },
    LM_STUDIO_TEXT_MODEL: { label: 'Modèle texte local', help: 'Nom exact du modèle chargé dans LM Studio.' },
    LM_STUDIO_VISION_MODEL: { label: 'Modèle vision local', help: 'Analyse d’images en local.' },
    LM_STUDIO_EMBEDDING_MODEL: { label: 'Modèle embeddings local', help: 'Recherche mémoire par sens.' },
    LM_STUDIO_TIMEOUT_MS: { label: 'Délai max requête locale (ms)', help: 'Défaut 240000.' },
    GEMINI_MODEL: { label: 'Modèle Gemini' },
    DEEPSEEK_BASE_URL: { label: 'Adresse API DeepSeek' },
    DEEPSEEK_MODEL: { label: 'Modèle DeepSeek' },
    OPENROUTER_BASE_URL: { label: 'Adresse API OpenRouter' },
    OPENROUTER_VISION_MODEL: { label: 'Modèle vision OpenRouter' },
    MODAL_ENDPOINT: { label: 'Endpoint Modal (inférence privée)' },
    MODAL_MODEL: { label: 'Modèle Modal' },
    HF_INFERENCE_BASE_URL: { label: 'Adresse inférence Hugging Face' },
    HF_TEXT_MODEL: { label: 'Modèle texte Hugging Face' },
    HTTPSMS_BASE_URL: { label: 'Adresse du serveur httpSMS', help: 'Cloud api.httpsms.com ou votre serveur.' },
    HTTPSMS_FROM_NUMBER: { label: 'Numéro httpSMS', help: 'Numéro de la SIM du téléphone-passerelle (E.164).' },
    HTTPSMS_SMS_MODE: { label: 'Routage SMS httpSMS', help: 'native-first / httpsms-first / native-only / httpsms-only.' },
    TELEGRAM_OWNER_CHAT_ID: { label: 'ID Telegram du propriétaire', help: 'ID numérique via @userinfobot.' },
    SMS_SEND_MODE: { label: 'Mode d’envoi SMS', help: 'confirm_every_send / auto_allowlisted / draft_only.' },
    SMS_ALLOWLIST: { label: 'Numéros SMS autorisés', help: 'E.164 séparés par des virgules.' },
    SMS_QUIET_HOURS_START: { label: 'Heures calmes SMS — début', help: 'Heure 0–23. Vide = désactivé.' },
    SMS_QUIET_HOURS_END: { label: 'Heures calmes SMS — fin', help: 'Heure 0–23. Vide = désactivé.' },
    SMS_MAX_PER_MINUTE: { label: 'SMS maximum par minute' },
    SMS_MAX_PER_DAY: { label: 'SMS maximum par jour' },
  };
  elements.settingsFields.textContent = '';
  schema.nonSensitiveKeys.filter((key) => !['MINA_INFERENCE_MODE', 'MINA_OFFLINE'].includes(key)).forEach((key) => {
    const meta = SETTINGS_LABELS[key] ?? { label: key };
    const isCheckbox = key.endsWith('_ENABLED');
    const label = document.createElement('label');
    const title = document.createElement('span');
    const input = document.createElement('input');
    title.textContent = meta.label;
    input.dataset.envKey = key;
    input.type = isCheckbox ? 'checkbox' : 'text';
    if (isCheckbox) {
      // Coche PUIS libellé sur la même ligne (jamais un carré sans texte à côté).
      input.checked = settingValue(key, state) === true;
      label.className = 'settings-toggle';
      label.append(input, title);
    } else {
      input.value = settingValue(key, state) ?? '';
      label.append(title, input);
    }
    // Indice : le texte d'aide + le nom technique de la variable (pour qui le cherche).
    const hint = document.createElement('small');
    hint.className = 'settings-hint';
    hint.textContent = meta.help ? `${meta.help} · ${key}` : key;
    label.append(hint);
    elements.settingsFields.append(label);
  });
  const secretStatus = new Map(state.secrets.map((entry) => [entry.providerId, entry.configured]));
  elements.settingsProviders.textContent = '';
  schema.providers.forEach((provider) => {
    const card = document.createElement('article');
    const title = document.createElement('strong');
    const status = document.createElement('small');
    title.textContent = `${provider.id} · ${provider.locality}`;
    const configured = provider.id === 'lmStudio' ? state.config.providers.lmStudio.enabled : secretStatus.get(provider.id) === true;
    status.textContent = configured ? 'Configuré' : 'Non configuré';
    card.append(title, status);
    let secretInput = null;
    if (provider.id !== 'lmStudio') {
      secretInput = document.createElement('input');
      secretInput.type = 'password';
      secretInput.autocomplete = 'new-password';
      secretInput.placeholder = 'Nouveau secret — jamais réaffiché';
      card.append(secretInput);
      const save = document.createElement('button');
      save.type = 'button';
      save.textContent = 'Chiffrer le secret';
      save.addEventListener('click', async () => {
        try {
          if (!secretInput.value) return;
          await api.setProviderSecret({ providerId: provider.id, value: secretInput.value });
          secretInput.value = '';
          log(`Secret ${provider.id} enregistré dans le keyring.`);
          await refreshSettings();
        } catch (error) { secretInput.value = ''; log(`Secret ${provider.id} : ${error.message}`); }
      });
      card.append(save);
      const revoke = document.createElement('button');
      revoke.type = 'button';
      revoke.textContent = 'Révoquer localement';
      revoke.disabled = !configured;
      revoke.addEventListener('click', async () => { await api.revokeProviderSecret({ providerId: provider.id }); await refreshSettings(); });
      card.append(revoke);
    }
    const test = document.createElement('button');
    test.type = 'button';
    test.textContent = 'Valider la configuration';
    test.addEventListener('click', async () => {
      try { await api.testProvider({ providerId: provider.id }); log(`Configuration ${provider.id} valide.`); }
      catch (error) { log(`Configuration ${provider.id} : ${error.message}`); }
    });
    card.append(test);
    elements.settingsProviders.append(card);
  });
};

const localDateTimeValue = (date) => {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

const analyticsRequest = () => ({
  from: new Date(elements.analyticsFrom.value).toISOString(),
  to: new Date(elements.analyticsTo.value).toISOString(),
  page: 1,
  pageSize: 100,
});

const refreshAnalytics = async () => {
  const result = await api.queryAnalytics(analyticsRequest());
  const aggregate = result.aggregates;
  const cards = [
    ['Appels', aggregate.attempts],
    ['Succès', aggregate.successRate === null ? '—' : `${Math.round(aggregate.successRate * 100)} %`],
    ['Tokens entrée', aggregate.inputTokens],
    ['Tokens cache', aggregate.cachedInputTokens],
    ['Tokens sortie', aggregate.outputTokens],
    ['Raisonnement', aggregate.reasoningTokens],
    ['Coût connu', `${(aggregate.budgetConsumptionMicros / 1_000_000).toFixed(6)} ${result.items[0]?.currency ?? 'USD'}`],
    ['Coûts inconnus', aggregate.unknownCostAttempts],
    ['Latence p95', aggregate.p95LatencyMs === null ? '—' : `${Math.round(aggregate.p95LatencyMs)} ms`],
  ];
  elements.analyticsSummary.textContent = '';
  cards.forEach(([label, value]) => {
    const card = document.createElement('article');
    const strong = document.createElement('strong');
    const small = document.createElement('small');
    strong.textContent = String(value);
    small.textContent = label;
    card.append(strong, small);
    elements.analyticsSummary.append(card);
  });
  elements.analyticsResults.textContent = '';
  result.items.forEach((item) => {
    const row = document.createElement('li');
    const title = document.createElement('strong');
    const detail = document.createElement('small');
    title.textContent = `${item.providerId} · ${item.modelId} · ${item.status}`;
    detail.textContent = `${formatDate(item.startedAt)} · ${item.capability} · ${item.latencyMs} ms · ${item.costMicros ?? 'coût inconnu'} µ$`;
    row.append(title, detail);
    elements.analyticsResults.append(row);
  });
  if (!result.items.length) elements.analyticsResults.append(listEntry('Aucune utilisation enregistrée', 'Les métriques apparaîtront après un appel modèle instrumenté.', null));
};

const refreshToday = async () => {
  const briefing = await api.getDailyBriefing({ identityId: 'owner', asOf: Date.now(), channel: 'local' });
  elements.todayItems.textContent = '';
  briefing.items.forEach((item) => {
    elements.todayItems.append(listEntry(item.text ?? item.section, `${item.section} · ${item.sourceRef}`, null));
  });
  briefing.staleItems.forEach((item) => {
    elements.todayItems.append(listEntry(item.text ?? item.section, item.label, null));
  });
  if (!briefing.items.length && !briefing.staleItems.length) {
    elements.todayItems.append(listEntry('Rien à signaler', 'Aucune source configurée ou rien de nouveau aujourd’hui.', null));
  }
};

const refreshAutomationStatus = async () => {
  const [definitions, cases, health] = await Promise.all([
    api.listAutomationDefinitions(),
    api.listRecoveryCases(),
    api.healthSnapshot(),
  ]);
  const openCases = cases.filter((entry) => !entry.closedManually).length;
  const failedProbes = health.filter((entry) => entry.status === 'failed').length;
  const cards = [
    ['Définitions', definitions.length],
    ['Cas de recovery ouverts', openCases],
    ['Sondes santé (échecs)', `${failedProbes} / ${health.length}`],
  ];
  elements.automationSummary.textContent = '';
  cards.forEach(([label, value]) => {
    const card = document.createElement('article');
    const strong = document.createElement('strong');
    const small = document.createElement('small');
    strong.textContent = String(value);
    small.textContent = label;
    card.append(strong, small);
    elements.automationSummary.append(card);
  });
  const emergency = await api.getEmergencyStatus();
  elements.emergencyNetworkState.textContent = `Réseau : ${emergency.network === 'disabled' ? 'coupé (urgence active)' : 'normal'}`;
};

// Read-only status card: Approbations/Connecteurs/Éditeurs approuvés/Personnalité admin actions
// (publisher approval, connector activation, personality patch confirmation) stay main-process/local
// and are deliberately never exposed here — this panel only ever displays counts and current style.
const refreshExtensionsStatus = async () => {
  const [connectors, personality] = await Promise.all([api.listConnectors(), api.getPersonalityProfile()]);
  const cards = [
    ['Connecteurs installés', connectors.length],
    ['Personnalité — nom', personality.displayName],
    ['Personnalité — ton', personality.tone],
  ];
  elements.extensionsSummary.textContent = '';
  cards.forEach(([label, value]) => {
    const card = document.createElement('article');
    const strong = document.createElement('strong');
    const small = document.createElement('small');
    strong.textContent = String(value);
    small.textContent = label;
    card.append(strong, small);
    elements.extensionsSummary.append(card);
  });
};

const listEntry = (title, detail, buttonLabel, onClick, disabled = false) => {
  const row = document.createElement('li');
  const strong = document.createElement('strong');
  const small = document.createElement('small');
  strong.textContent = title;
  small.textContent = detail;
  row.append(strong, small);
  if (buttonLabel) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = buttonLabel;
    button.disabled = disabled;
    button.addEventListener('click', () => { void onClick(); });
    row.append(button);
  }
  return row;
};

const refreshSkillsSandbox = async () => {
  const state = await api.skillsSandboxStatus();
  sandboxAvailable = state.sandbox.available;
  elements.minaDigest.textContent = `MINA.md v${state.instructions.version} · ${state.instructions.digest.slice(0, 18)}…`;
  elements.sandboxState.textContent = sandboxAvailable ? 'Sandbox disponible' : `Sandbox bloqué · ${state.sandbox.reason}`;
  elements.sandboxState.className = sandboxAvailable ? 'ready' : 'blocked';
  elements.sandboxRemediation.textContent = state.sandbox.remediation || '';
  elements.skillList.textContent = '';
  state.installedSkills.forEach((skill) => elements.skillList.append(listEntry(
    `${skill.name} · ${skill.version} · installé`,
    `${skill.capabilities.join(', ') || 'aucune capacité'} · ${skill.channels.join(', ')}`,
  )));
  (state.bundledSkills ?? []).forEach((skill) => elements.skillList.append(listEntry(
    `${skill.name} · ${skill.version} · intégré`,
    `${skill.capabilities.join(', ') || 'aucune capacité'} · ${skill.channels.join(', ')}`,
  )));
  if (!state.installedSkills.length && !(state.bundledSkills ?? []).length) elements.skillList.append(listEntry('Aucun skill disponible', 'Utilisez la quarantaine locale.', null));
  elements.sandboxProposals.textContent = '';
  state.proposals.forEach((proposal) => elements.sandboxProposals.append(listEntry(
    proposal.summary || proposal.proposalId,
    `Permissions : ${(proposal.requestedPermissions ?? []).join(', ') || 'aucune'}`,
    'Exécuter',
    async () => {
      try {
        await api.executeSandbox({ proposalId: proposal.proposalId });
        await refreshSkillsSandbox();
      } catch (error) { log(`Sandbox : ${error.message}`); }
    },
    !sandboxAvailable,
  )));
  if (!state.proposals.length) elements.sandboxProposals.append(listEntry('Aucune proposition', 'L’exécution exige une demande explicite.', null));
  elements.sandboxJobs.textContent = '';
  state.jobs.forEach((job) => elements.sandboxJobs.append(listEntry(
    `${job.jobId} · ${job.status}`,
    job.summary || 'Job isolé',
    'Annuler',
    async () => { await api.cancelSandbox({ jobId: job.jobId }); await refreshSkillsSandbox(); },
    !['running', 'starting'].includes(job.status),
  )));
  elements.sandboxArtifacts.textContent = '';
  state.artifacts.forEach((artifact) => elements.sandboxArtifacts.append(listEntry(
    artifact.name || artifact.artifactId,
    artifact.digest || 'Empreinte indisponible',
    'Importer',
    async () => { await api.importSandboxArtifact({ jobId: artifact.jobId, artifactId: artifact.artifactId }); },
  )));
};

const applyStatusFromHealth = (status) => {
  const rotated = status.ok && status.config?.credentialsRotated;
  elements.lockPanel.hidden = rotated;
  if (!rotated) {
    elements.lockText.textContent = status.ok
      ? 'Les clés vues pendant la configuration doivent être renouvelées. Mina reste hors ligne jusque-là.'
      : status.error;
    setStatus('Clés à renouveler', 'blocked');
    elements.start.disabled = true;
    elements.dental.disabled = true;
    elements.voice.disabled = true;
  } else {
    elements.start.disabled = false;
    elements.dental.disabled = false;
    elements.voice.disabled = false;
    setStatus('Prête', 'ready');
  }
};

elements.start.addEventListener('click', () => { void startMission(); });
// Nothing in the backend actually stays stuck after an emergency stop (mina-runtime.mjs keeps
// runtimeStatus === 'ready') — only the status pill did, with no way back except restarting the
// whole app. This just re-checks health and puts the UI back to 'Prête' without a real restart.
elements.resume.addEventListener('click', async () => {
  log('Relance demandée après arrêt.');
  try {
    const status = await api.status();
    applyStatusFromHealth(status);
    log('Mina relancée : prête pour une nouvelle instruction.');
  } catch (error) {
    setStatus('Action bloquée', 'blocked');
    log(`Relance : ${error.message}`);
  }
});
elements.stop.addEventListener('click', async () => {
  await api.stop();
  setBusy(false);
  setStatus('Arrêter', 'blocked');
  log('Arrêt d’urgence déclenché. Les entrées ont été relâchées.');
});
elements.dental.addEventListener('click', async () => {
  if (busy) return;
  setBusy(true);
  setStatus('Analyse dentaire', 'ready', true);
  log('Analyse Google Photos démarrée.');
  try {
    const report = await api.dental({ maxItems: 100 });
    log(`Analyse terminée : ${report.analyzed} analysées, ${report.selected} retenues, ${report.errors} erreur(s).`);
    setStatus('Prête', 'ready');
  } catch (error) {
    log(`Google Photos : ${error.message}`);
    setStatus('Action bloquée', 'blocked');
  } finally {
    setBusy(false);
  }
});
elements.phone.addEventListener('click', async () => {
  elements.phoneStatus.textContent = 'Détection…';
  try {
    const phone = await api.detectPhone();
    elements.phoneStatus.textContent = phone.model || 'Android détecté';
    log(`Téléphone détecté : ${phone.model || 'Android'}.`);
  } catch (error) {
    elements.phoneStatus.textContent = 'Non connecté / non autorisé';
    void reportTechnicalError('phone', 'phone_detection_failed', error);
    // Message actionnable : la détection Wi-Fi passe par MINA_ADB_WIFI_HOSTS (Samsung/Huawei hors mDNS).
    const hint = /identité|gateway|autoris/iu.test(error.message)
      ? ' — le téléphone doit être appairé et déverrouillé (USB, ou Wi-Fi via MINA_ADB_WIFI_HOSTS dans .env).'
      : '';
    log(`Téléphone : ${error.message}${hint}`);
  }
});
elements.camera.addEventListener('click', async () => {
  try {
    if (cameraStreaming) {
      await api.stopPhoneCamera();
      cameraStreaming = false;
      elements.cameraStatus.textContent = 'Caméra signée · arrêt sécurisé';
      elements.cameraPreview.hidden = true;
      elements.cameraSwitch.hidden = true;
      elements.cameraFrame.removeAttribute('src');
      log('Flux caméra Huawei arrêté.');
    } else {
      await api.startPhoneCamera();
      cameraStreaming = true;
      cameraLens = 'front';
      cameraFlipTried = false;
      greetedOnSight = false;
      cameraGreetContext = undefined;
      elements.cameraStatus.textContent = 'Démarrage CameraX…';
      log('Flux CameraX signé demandé au Huawei appairé.');
    }
  } catch (error) {
    void reportTechnicalError('camera', 'camera_toggle_failed', error);
    log(`Caméra : ${error.message}`);
  }
});

// G3 — Vision par la WEBCAM DU PC (sans téléphone). Ouvre la webcam via getUserMedia, capture UNE
// image, la fait analyser par le même fournisseur de vision que la caméra du téléphone, puis relâche
// la webcam tout de suite (le voyant s'éteint). Rien n'est enregistré : l'image ne vit qu'en mémoire
// le temps de l'analyse. Honnête : sans identifiants IA, l'analyse échoue et on le dit.
let webcamBusy = false;
const analyzeWebcamPc = async (question) => {
  if (webcamBusy) return;
  webcamBusy = true;
  const target = elements.webcamVisionStatus;
  if (target) target.textContent = 'Ouverture de la webcam…';
  let stream = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    // Laisse le capteur s'exposer un court instant avant la capture (sinon image noire au démarrage).
    await new Promise((resolve) => setTimeout(resolve, 350));
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    const imageBase64 = dataUrl.split(',')[1] ?? '';
    if (target) target.textContent = 'Mina regarde…';
    const result = await api.analyzeVisionFrame({ imageBase64, mimeType: 'image/jpeg', prompt: question, source: 'webcam_pc' });
    if (result?.ok) {
      if (target) target.textContent = 'Vue analysée par la webcam PC';
      log(`Webcam PC : ${result.text}`);
      void say(result.text);
    } else {
      if (target) target.textContent = 'Analyse indisponible';
      log(`Webcam PC : analyse indisponible (${result?.reason ?? 'inconnu'}).`);
    }
  } catch (error) {
    if (target) target.textContent = 'Webcam indisponible';
    log(`Webcam PC : ${error.message}`);
  } finally {
    if (stream) for (const track of stream.getTracks()) track.stop(); // relâche la webcam (voyant off)
    webcamBusy = false;
  }
};
if (elements.webcamVision) elements.webcamVision.addEventListener('click', () => { void analyzeWebcamPc(); });

// G5 — « Décrire une image » : Mina décrit un fichier image choisi par Nasro (boîte système).
if (elements.visionFile) elements.visionFile.addEventListener('click', async () => {
  const target = elements.visionFileStatus;
  if (target) target.textContent = 'Choix du fichier…';
  try {
    const result = await api.analyzeVisionFile({});
    if (result?.ok) { if (target) target.textContent = `Décrit : ${result.name}`; log(`Image « ${result.name} » : ${result.text}`); void say(result.text); }
    else if (result?.reason === 'annule') { if (target) target.textContent = 'Choisis un fichier · Mina te dit ce qu’elle voit'; }
    else { if (target) target.textContent = 'Analyse indisponible'; log(`Décrire une image : ${result?.reason ?? 'inconnu'}.`); }
  } catch (error) { if (target) target.textContent = 'Erreur'; log(`Décrire une image : ${error.message}`); }
});

// G5 — « Conversation téléphone » : bascule sur l'onglet Config (canal mina_app) et rafraîchit son état.
if (elements.conversationTool) elements.conversationTool.addEventListener('click', async () => {
  document.querySelector('.rail-btn[data-view="config"]')?.click();
  try {
    const status = await api.chatStatus();
    const connected = Array.isArray(status?.connectedDevices) ? status.connectedDevices.length : 0;
    if (elements.conversationStatus) {
      elements.conversationStatus.textContent = status?.listening
        ? `À l'écoute · ${connected} téléphone(s) connecté(s)`
        : (status?.vaultUnlocked === false ? 'Mémoire verrouillée — déverrouille pour ouvrir le canal' : 'Canal fermé');
    }
    await refreshChatChannel();
  } catch (error) { log(`Conversation : ${error.message}`); }
});

const flipCameraLens = async () => {
  if (!cameraStreaming) { log('Caméra : démarre le flux avant d’inverser l’objectif.'); return; }
  const nextLens = cameraLens === 'front' ? 'back' : 'front';
  try {
    await api.switchCameraLens({ lens: nextLens });
    cameraLens = nextLens;
    log(`Caméra inversée : objectif ${nextLens === 'front' ? 'avant' : 'arrière'}.`);
  } catch (error) {
    void reportTechnicalError('camera', 'camera_lens_switch_failed', error);
    log(`Inversion caméra : ${error.message}`);
  }
};
elements.cameraSwitch.addEventListener('click', () => { void flipCameraLens(); });

const applyToolsCollapsed = (collapsed) => {
  elements.workspace.classList.toggle('tools-collapsed', collapsed);
  elements.toolsToggle.setAttribute('aria-expanded', String(!collapsed));
  elements.toolsToggleLabel.textContent = collapsed ? 'Afficher outils' : 'Masquer outils';
};
let toolsCollapsed = true;
try { toolsCollapsed = localStorage.getItem('mina.toolsCollapsed') !== '0'; } catch { /* storage optional */ }
applyToolsCollapsed(toolsCollapsed);
elements.helpButton.addEventListener('click', () => { api.openHelp().catch((error) => log(`Guide : ${error.message}`)); });

const THEME_STORAGE_KEY = 'mina.theme';
// Single source of truth is the DOM attribute itself — no separate JS variable to keep in sync,
// so both the header click and the "je veux la version nuit" voice command call the same function.
// The icon itself never touches innerHTML (renderer.js has a hard no-HTML-injection contract):
// both SVG states are static markup in index.html, and pure CSS keyed off :root[data-theme] shows
// the one matching the theme a click would activate (sun while dark is active, moon while light).
const applyTheme = (theme) => {
  const next = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem(THEME_STORAGE_KEY, next); } catch { /* storage optional */ }
  return next;
};
const currentTheme = () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
let initialTheme = 'light';
try { initialTheme = localStorage.getItem(THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light'; } catch { /* storage optional */ }
applyTheme(initialTheme);
elements.themeToggle.addEventListener('click', () => applyTheme(currentTheme() === 'dark' ? 'light' : 'dark'));

// Résout un thème stocké « system » vers clair/sombre selon l'OS (les variables CSS ne gèrent que
// light/dark ; « system » est un choix, pas un état DOM).
const resolveTheme = (theme) => {
  if (theme === 'light' || theme === 'dark') return theme;
  try { return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch { return 'light'; }
};

// G7 — Fenêtre de bienvenue : premier lancement (aucun profil / accueil non terminé) OU création
// d'un nouveau profil. Applique le thème du profil actif au démarrage, personnalise Mina, et gère
// l'initialisation mémoire (avec affichage de la phrase de récupération — cause racine du blocage
// mémoire corrigée) y compris le cas « coffre illisible » (repartir à neuf, archive sans supprimer).
const welcome = (() => {
  const overlay = document.querySelector('#welcome-overlay');
  if (!overlay) return { boot: async () => {} };
  const $ = (sel) => overlay.querySelector(sel);
  const steps = [...overlay.querySelectorAll('.welcome-step')];
  const showStep = (n) => steps.forEach((s) => { s.hidden = Number(s.dataset.step) !== n; });
  const show = () => { overlay.hidden = false; };
  const hide = () => { overlay.hidden = true; };
  const draft = { theme: 'system' };

  $('#welcome-theme').addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    applyTheme(next);
  });
  $('#welcome-start').addEventListener('click', () => showStep(2));
  $('#welcome-back-1').addEventListener('click', () => showStep(1));
  $('#welcome-theme-choice').addEventListener('change', (e) => applyTheme(resolveTheme(e.target.value)));

  $('#welcome-save').addEventListener('click', async () => {
    const input = {
      name: $('#welcome-name').value,
      pronouns: $('#welcome-pronouns').value,
      language: $('#welcome-language').value,
      tone: $('#welcome-tone').value,
      theme: $('#welcome-theme-choice').value,
      preferences: $('#welcome-preferences').value,
    };
    try {
      const profile = await api.upsertProfile(input);
      draft.theme = profile.theme;
      applyTheme(resolveTheme(profile.theme));
      await prepareMemoryStep();
      showStep(3);
    } catch (error) { log(`Profil : ${error.message}`); }
  });

  // Étape mémoire : sonde l'état réel du coffre pour proposer soit l'initialisation, soit —
  // uniquement si le coffre est illisible — le « repartir à neuf ».
  const prepareMemoryStep = async () => {
    let probe = { state: 'uninitialized' };
    try { probe = await api.probeMemory?.() ?? probe; } catch { /* sonde best-effort */ }
    const repair = $('#welcome-mem-repair');
    const initActions = $('#welcome-mem-actions');
    if (probe.state === 'dpapi_unrecoverable') {
      repair.hidden = false; initActions.hidden = true;
      $('#welcome-mem-lead').textContent = 'Une mémoire existe déjà mais Windows ne peut plus la déchiffrer.';
    } else if (probe.state === 'healthy') {
      // Déjà initialisée et saine : rien à faire ici, on file vers l'entrée.
      initActions.hidden = true; $('#welcome-finish-actions').hidden = false;
      $('#welcome-mem-lead').textContent = 'Ta mémoire chiffrée est déjà prête.';
    } else {
      repair.hidden = true; initActions.hidden = false;
    }
  };

  const showPhrase = (phrase) => {
    $('#welcome-phrase').textContent = `Phrase de récupération (note-la hors du PC, affichée une seule fois) :\n\n${phrase}`;
    $('#welcome-phrase').hidden = false;
    $('#welcome-finish-actions').hidden = false;
  };

  $('#welcome-mem-init').addEventListener('click', async () => {
    try {
      const state = await api.initializeMemory();
      showPhrase(state.recoveryPhrase);
      $('#welcome-mem-actions').hidden = true;
    } catch (error) {
      // Déjà initialisée ailleurs, ou coffre illisible : on re-sonde pour proposer la bonne action.
      log(`Mémoire : ${error.message}`);
      await prepareMemoryStep();
    }
  });

  $('#welcome-mem-reinit').addEventListener('click', async () => {
    try {
      const result = await api.reinitializeMemoryFresh();
      if (result?.ok) { showPhrase(result.recoveryPhrase); $('#welcome-mem-repair').hidden = true; }
      else log(`Ré-initialisation refusée : ${result?.reason ?? 'inconnu'}`);
    } catch (error) { log(`Ré-initialisation : ${error.message}`); }
  });

  $('#welcome-skip-mem').addEventListener('click', async () => { await finish(); });
  $('#welcome-finish').addEventListener('click', async () => { await finish(); });

  const finish = async () => {
    try { await api.completeWelcome(); } catch { /* best-effort */ }
    hide();
    try { await refreshMemoryStatus(); } catch { /* la mémoire se rafraîchit d'elle-même */ }
  };

  const renderExisting = (profiles) => {
    const box = $('#welcome-existing');
    const list = $('#welcome-profile-list');
    list.textContent = '';
    if (!profiles.length) { box.hidden = true; return; }
    box.hidden = false;
    for (const p of profiles) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = p.name;
      b.addEventListener('click', async () => {
        try { await api.setActiveProfile(p.id); applyTheme(resolveTheme(p.theme)); await finish(); }
        catch (error) { log(`Profil : ${error.message}`); }
      });
      list.append(b);
    }
  };

  return {
    async boot() {
      // Fenêtre-d'abord (T1.1) : au premier paint, les handlers IPC ne sont pas encore prêts et
      // `readProfiles` REJETTE. On distingue ce cas d'un « aucun profil » réel : sur rejet on ne
      // montre RIEN (sinon overlay de bienvenue fantôme pour un utilisateur existant), et on
      // réessaie à la réception de `mina:boot:ready`. Sur succès, la décision d'accueil est fiable.
      let state;
      try { state = await api.readProfiles?.(); }
      catch { return; }
      state = state ?? { profiles: [], activeProfileId: null, welcomeCompleted: false };
      const active = state.profiles.find((p) => p.id === state.activeProfileId);
      if (active) applyTheme(resolveTheme(active.theme)); // thème du profil dès le lancement
      if (state.welcomeCompleted && active) return; // déjà accueilli
      renderExisting(state.profiles);
      showStep(1);
      show();
    },
  };
})();

// Réglages de profil dans l'onglet Config — MÊMES champs que la bienvenue, éditables à tout moment
// (demande Nasro : « les mêmes réglages dans les paramètres »). Multi-utilisateurs : bascule le
// profil actif, en crée de nouveaux. upsert({id}) MET À JOUR (l'id vient du profil actif) ; sans id
// il CRÉE. Ne touche jamais MINA.md (constitution immuable) : uniquement salutation, ton, thème.
const profileSettings = (() => {
  const sel = (id) => document.querySelector(id);
  const selectEl = sel('#profile-select');
  if (!selectEl) return { refresh: async () => {} };
  const fields = {
    name: sel('#profile-name'), pronouns: sel('#profile-pronouns'), language: sel('#profile-language'),
    tone: sel('#profile-tone'), theme: sel('#profile-theme'), preferences: sel('#profile-preferences'),
  };
  const status = sel('#profile-status');
  const NEW = '__new__';
  let editingId = null; // id du profil édité ; null = création d'un nouveau

  const say = (msg) => { if (status) status.textContent = msg; };
  const fill = (p) => {
    // « Utilisateur » est le nom par défaut du store quand aucun n'est saisi : on n'affiche pas ce
    // libellé technique dans le champ (l'utilisateur croirait que c'est SON nom).
    fields.name.value = p && p.name && p.name !== 'Utilisateur' ? p.name : '';
    fields.pronouns.value = p?.pronouns ?? '';
    fields.language.value = p?.language ?? 'fr';
    fields.tone.value = p?.tone ?? 'chaleureux';
    fields.theme.value = p?.theme ?? 'system';
    fields.preferences.value = p?.preferences ?? '';
  };
  const startNew = () => {
    editingId = null; selectEl.value = NEW; fill(null); fields.name.focus();
    say('Nouveau profil : remplis les champs puis « Enregistrer ».');
  };

  const refresh = async () => {
    let state = { profiles: [], activeProfileId: null };
    try { state = await api.readProfiles?.() ?? state; } catch { /* pas de profils encore */ }
    selectEl.textContent = '';
    for (const p of state.profiles) {
      const opt = document.createElement('option');
      opt.value = p.id; opt.textContent = p.name;
      selectEl.append(opt);
    }
    const newOpt = document.createElement('option');
    newOpt.value = NEW; newOpt.textContent = '＋ Nouveau profil…';
    selectEl.append(newOpt);
    const active = state.profiles.find((p) => p.id === state.activeProfileId) ?? state.profiles[0] ?? null;
    if (active) { editingId = active.id; selectEl.value = active.id; fill(active); }
    else { startNew(); }
  };

  selectEl.addEventListener('change', async () => {
    if (selectEl.value === NEW) { startNew(); return; }
    try {
      const profile = await api.setActiveProfile(selectEl.value); // renvoie le profil devenu actif
      editingId = profile.id;
      fill(profile);
      applyTheme(resolveTheme(profile.theme));
      say(`Profil actif : ${profile.name}.`);
    } catch (error) { say(`Profil : ${error.message}`); }
  });

  sel('#profile-new').addEventListener('click', startNew);

  sel('#profile-save').addEventListener('click', async () => {
    const input = {
      name: fields.name.value, pronouns: fields.pronouns.value, language: fields.language.value,
      tone: fields.tone.value, theme: fields.theme.value, preferences: fields.preferences.value,
    };
    if (editingId) input.id = editingId; // met à jour le profil existant ; sinon en crée un
    try {
      const profile = await api.upsertProfile(input);
      applyTheme(resolveTheme(profile.theme));
      await refresh();
      say(`Enregistré. Mina s'adresse à ${profile.name} (ton ${profile.tone}).`);
    } catch (error) { say(`Enregistrement : ${error.message}`); }
  });

  return { refresh };
})();

// Rail navigation: Mission stays reachable from anywhere; the four secondary zones are views you
// switch to (aria-current + a shown/hidden .view), not a scroll you fall through. Pure CSS-class
// toggling — every IPC-driven update inside a hidden view keeps happening in the background and
// is simply visible again the moment its zone is reselected.
const railButtons = [...document.querySelectorAll('.rail-btn[data-view]')];
const dashboardViews = [...document.querySelectorAll('.view[data-view]')];
railButtons.forEach((button) => {
  button.addEventListener('click', () => {
    railButtons.forEach((entry) => entry.removeAttribute('aria-current'));
    button.setAttribute('aria-current', 'true');
    dashboardViews.forEach((view) => view.classList.toggle('is-active', view.dataset.view === button.dataset.view));
  });
});

// Vue Mina Code : panneaux DOM purs (src/ui/code/*) branchés sur l'IPC code. Fail-soft complet —
// sans pont preload (page ouverte hors Electron), la vue affiche « indisponible » et rien ne casse.
const codeElements = {
  context: document.querySelector('#code-context-panel'),
  plan: document.querySelector('#code-plan-board'),
  tests: document.querySelector('#code-test-panel'),
  git: document.querySelector('#code-git-panel'),
  diff: document.querySelector('#code-diff-panel'),
  terminal: document.querySelector('#code-terminal'),
  indexButton: document.querySelector('#code-index-button'),
  testsButton: document.querySelector('#code-tests-button'),
  reviewButton: document.querySelector('#code-review-button'),
  gitButton: document.querySelector('#code-git-button'),
};
if (codeElements.terminal) {
  void (async () => {
    const [{ createCodePlanBoard }, { createCodeDiffViewer }, { createCodeTestPanel }, { createCodeGitPanel }, { createCodeContextPanel }, { createCodeTerminal }] = await Promise.all([
      import('./code/code-plan-board.mjs'),
      import('./code/code-diff-viewer.mjs'),
      import('./code/code-test-panel.mjs'),
      import('./code/code-git-panel.mjs'),
      import('./code/code-context-panel.mjs'),
      import('./code/code-terminal.mjs'),
    ]);
    const panels = {
      plan: createCodePlanBoard({ container: codeElements.plan }),
      diff: createCodeDiffViewer({ container: codeElements.diff }),
      tests: createCodeTestPanel({ container: codeElements.tests }),
      git: createCodeGitPanel({ container: codeElements.git }),
      context: createCodeContextPanel({ container: codeElements.context }),
      terminal: createCodeTerminal({ container: codeElements.terminal }),
    };
    panels.plan.render({});
    panels.diff.render({});
    panels.tests.render({});
    panels.git.render({});
    panels.context.render({});

    const codeCall = async (label, method, request) => {
      if (typeof api?.[method] !== 'function') {
        panels.terminal.append(`${label} : indisponible (pont preload absent)`, 'err');
        return null;
      }
      panels.terminal.append(label, 'cmd');
      const response = await api[method](request).catch((error) => ({ ok: false, error: String(error?.message ?? error) }));
      if (!response?.ok) {
        panels.terminal.append(`${label} : ${response?.error ?? 'échec inconnu'}`, 'err');
        return null;
      }
      return response.data;
    };

    const refreshStatus = async () => {
      const status = await codeCall('Statut du projet', 'codeStatus');
      if (status) {
        panels.context.render({ projectRoot: status.projectRoot, projectContext: { framework: status.framework, scripts: {} }, indexStatus: status.index });
      }
    };

    codeElements.indexButton?.addEventListener('click', async () => {
      const report = await codeCall('Analyse du projet (indexation complète)', 'codeIndex');
      if (report) {
        panels.terminal.append(`Indexation : ${report.indexed}/${report.total} fichier(s), ${report.errors.length} erreur(s) de parse`, report.errors.length > 0 ? 'info' : 'ok');
        await refreshStatus();
      }
    });
    codeElements.testsButton?.addEventListener('click', async () => {
      panels.terminal.append('Tests en cours — cela peut prendre plusieurs minutes…', 'info');
      const result = await codeCall('npm test (vitest)', 'codeTestsRun', {});
      if (result) {
        panels.tests.render({ result });
        panels.terminal.append(`Tests : ${result.passed ?? 0} verts, ${result.failed ?? 0} rouges`, result.failed > 0 || result.crashed ? 'err' : 'ok');
      }
    });
    codeElements.reviewButton?.addEventListener('click', async () => {
      const report = await codeCall('Revue de code (fichiers indexés)', 'codeReview', {});
      if (report) {
        const { critical = 0, high = 0, medium = 0, low = 0 } = report.summary ?? {};
        panels.terminal.append(`Revue : ${report.findings.length} finding(s) — ${critical} critique(s), ${high} élevé(s), ${medium} moyen(s), ${low} faible(s)`, critical + high > 0 ? 'err' : 'ok');
        for (const finding of report.findings.slice(0, 12)) {
          panels.terminal.append(`  [${finding.severity}] ${finding.proof}`, finding.severity === 'critical' ? 'err' : 'info');
        }
      }
    });
    codeElements.gitButton?.addEventListener('click', async () => {
      const [status, log, diff] = await Promise.all([
        codeCall('git status', 'codeGitStatus'),
        codeCall('git log', 'codeGitLog', { maxCount: 10 }),
        codeCall('git diff', 'codeGitDiff', {}),
      ]);
      panels.git.render({
        notRepository: status?.notRepository !== false,
        status: status?.status ?? null,
        log: log?.log ?? [],
      });
      panels.diff.render({ diffText: diff?.diff ?? '', title: 'Diff du dépôt' });
      if (status?.notRepository !== false) panels.terminal.append('Ce dossier n\'est pas un dépôt git.', 'info');
    });

    // Premier chargement paresseux : au premier clic sur l'onglet Code seulement.
    const codeRailButton = railButtons.find((button) => button.dataset.view === 'code');
    let loadedOnce = false;
    codeRailButton?.addEventListener('click', () => {
      if (loadedOnce) return;
      loadedOnce = true;
      void refreshStatus();
    });
  })();
}

// HUD clock: self-contained, no IPC — same instrument-panel reading as the rest of the strip.
const hudClock = document.querySelector('#hud-clock');
if (hudClock) {
  const tickClock = () => { hudClock.textContent = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); };
  tickClock();
  setInterval(tickClock, 1_000);
}

// Every section after "Configuration locale" folds the same way (pliant accordion): title/badges
// stay put in .activity-head, everything else lives in .collapsible > .collapsible-inner.
const wireCollapsibleSection = (toggleId, labelId, collapsibleId, storageKey) => {
  const toggle = document.querySelector(`#${toggleId}`);
  const label = document.querySelector(`#${labelId}`);
  const container = document.querySelector(`#${collapsibleId}`);
  let collapsed = true;
  try { collapsed = localStorage.getItem(storageKey) !== '0'; } catch { /* storage optional */ }
  const apply = (value) => {
    container.classList.toggle('collapsed', value);
    toggle.setAttribute('aria-expanded', String(!value));
    label.textContent = value ? 'Afficher' : 'Masquer';
  };
  apply(collapsed);
  toggle.addEventListener('click', () => {
    collapsed = !collapsed;
    apply(collapsed);
    try { localStorage.setItem(storageKey, collapsed ? '1' : '0'); } catch { /* storage optional */ }
  });
};
[
  ['profile-toggle', 'profile-toggle-label', 'profile-collapsible', 'mina.profileCollapsed'],
  ['system-toggle', 'system-toggle-label', 'system-collapsible', 'mina.systemCollapsed'],
  ['mail-toggle', 'mail-toggle-label', 'mail-collapsible', 'mina.mailCollapsed'],
  ['personal-toggle', 'personal-toggle-label', 'personal-collapsible', 'mina.personalCollapsed'],
  ['printing-toggle', 'printing-toggle-label', 'printing-collapsible', 'mina.printingCollapsed'],
  ['home-toggle', 'home-toggle-label', 'home-collapsible', 'mina.homeCollapsed'],
  ['settings-toggle', 'settings-toggle-label', 'settings-collapsible', 'mina.settingsCollapsed'],
  ['memory-panel-toggle', 'memory-panel-toggle-label', 'memory-panel-collapsible', 'mina.memoryPanelCollapsed'],
  ['analytics-toggle', 'analytics-toggle-label', 'analytics-collapsible', 'mina.analyticsCollapsed'],
  ['sandbox-toggle', 'sandbox-toggle-label', 'sandbox-collapsible', 'mina.sandboxCollapsed'],
  ['automation-toggle', 'automation-toggle-label', 'automation-collapsible', 'mina.automationCollapsed'],
  ['extensions-toggle', 'extensions-toggle-label', 'extensions-collapsible', 'mina.extensionsCollapsed'],
  ['today-toggle', 'today-toggle-label', 'today-collapsible', 'mina.todayCollapsed'],
  ['documents-toggle', 'documents-toggle-label', 'documents-collapsible', 'mina.documentsCollapsed'],
  ['technical-log-toggle', 'technical-log-toggle-label', 'technical-log-collapsible', 'mina.technicalLogCollapsed'],
  ['activity-toggle', 'activity-toggle-label', 'activity-collapsible', 'mina.activityCollapsed'],
].forEach(([toggleId, labelId, collapsibleId, storageKey]) => wireCollapsibleSection(toggleId, labelId, collapsibleId, storageKey));
elements.toolsToggle.addEventListener('click', () => {
  toolsCollapsed = !toolsCollapsed;
  applyToolsCollapsed(toolsCollapsed);
  try { localStorage.setItem('mina.toolsCollapsed', toolsCollapsed ? '1' : '0'); } catch { /* storage optional */ }
});

const evaluateFrameQuality = async () => {
  const stats = sampleFrameStats(elements.cameraFrame);
  if (!stats) return;
  const assessment = assessFrameQuality(stats);
  if (!assessment.usable) {
    const { flip, toLens } = decideLensFlip({ assessment, currentLens: cameraLens, alreadyFlipped: cameraFlipTried });
    if (flip) {
      cameraFlipTried = true;
      const label = assessment.reason === 'too_dark' ? 'noire' : 'floue';
      log(`Mina : la vision est ${label}, je retourne la caméra.`);
      void say(`La vision est ${label}, je retourne la caméra.`);
      try {
        await api.switchCameraLens({ lens: toLens });
        cameraLens = toLens;
      } catch (error) {
        log(`Inversion caméra : ${error.message}`);
      }
    }
    return;
  }
  // Greets on first usable frame whether the camera was opened by voice consent OR by the manual
  // button — "seeing" the owner is about the stream being live, not about who pressed start.
  if (!greetedOnSight) {
    greetedOnSight = true;
    const greeting = dialogue.greetOnSight(cameraGreetContext);
    log(`Mina : ${greeting}`);
    void say(greeting);
  }
};

api.onCameraFrame((frame) => {
  if (!frame || frame.mimeType !== 'image/jpeg' || typeof frame.imageBase64 !== 'string') return;
  elements.cameraFrame.onload = () => { void evaluateFrameQuality(); };
  elements.cameraFrame.src = `data:image/jpeg;base64,${frame.imageBase64}`;
  // CameraX reports rotationDegrees = how much to rotate clockwise so the image reads upright —
  // never applied before, so a front-camera frame (commonly 90/270 on most sensors) rendered on its side.
  const rotation = [0, 90, 180, 270].includes(frame.rotation) ? frame.rotation : 0;
  elements.cameraFrame.style.transform = rotation ? `rotate(${rotation}deg)` : '';
  elements.cameraPreview.hidden = false;
  elements.cameraSwitch.hidden = false;
  elements.cameraStatus.textContent = `Direct · image ${frame.sequence}`;
});

api.onCameraStatus((status) => {
  if (status?.state === 'starting' || status?.state === 'streaming') {
    cameraStreaming = true;
  } else if (status?.state === 'error') {
    cameraStreaming = false;
    elements.cameraSwitch.hidden = true;
    elements.cameraStatus.textContent = 'Flux indisponible';
    log(`Caméra : ${status.error}`);
  } else if (status?.state === 'stopped') {
    cameraStreaming = false;
    elements.cameraSwitch.hidden = true;
    elements.cameraStatus.textContent = 'Caméra signée · arrêt sécurisé';
  }
});
elements.voice.addEventListener('click', async () => {
  try {
    if (voiceCapture) await stopVoiceCapture();
    else await startVoiceCapture();
  } catch (error) {
    await api.stopVoice().catch(() => {});
    void reportTechnicalError('voice', 'voice_start_failed', error);
    log(`Voix : ${error.message}`);
    setStatus('Voix indisponible', 'blocked');
  }
});

api.onEvent((event) => {
  if (event.type === 'boot_ready') {
    // Fenêtre-d'abord (T1.1) : l'init des domaines est terminée, les handlers IPC existent enfin.
    // On rejoue le bootstrap pour que les données réelles remplacent l'état vide du premier paint —
    // et c'est ici que la décision d'accueil (welcome) devient fiable.
    bootstrapDashboard();
    return;
  }
  if (event.type === 'boot_error') {
    // L'init a échoué APRÈS l'ouverture de la fenêtre : on le dit dans le journal visible plutôt que
    // de laisser un tableau de bord muet. La fenêtre reste, l'utilisateur voit l'incident.
    log(`Démarrage incomplet : ${event.reason || 'erreur inconnue'}. Certaines capacités peuvent manquer.`);
    return;
  }
  if (event.type === 'action_completed') {
    actionCount += 1;
    elements.counter.textContent = `${actionCount} action${actionCount > 1 ? 's' : ''}`;
    log(`Action exécutée : ${event.action?.name || 'inconnue'}.`);
  } else if (event.type === 'action_rejected') {
    log(`Action rejetée : ${event.error}.`);
  } else if (event.type === 'action_unverified') {
    log(`${formatGroundingLabel('unsupported')} : ${event.actionResult?.verification?.reason || 'effet absent'}.`);
  } else if (event.type === 'emergency_stop') {
    setBusy(false);
    setStatus('Arrêter', 'blocked');
  } else if (event.type === 'dental_progress') {
    elements.counter.textContent = `${event.analyzed} photo${event.analyzed > 1 ? 's' : ''}`;
  } else if (event.type === 'voice_error') {
    voicePresence.dispatch({ type: 'failure' });
    log(`Voix : ${event.error}.`);
  } else if (event.type === 'phone_messages_synced') {
    log(`Téléphone : ${event.stored} nouveau(x) message(s) mémorisé(s).`);
  } else if (event.type === 'resilience_retry') {
    log(`Résilience : ${event.operation} a échoué (${event.error}), nouvel essai ${event.attempt + 1}…`);
    announceRetryOnce();
  } else if (event.type === 'action_error') {
    log(`Action plantée (${event.action?.name || 'inconnue'}) : ${event.error} — Mina contourne.`);
  } else if (event.type === 'chat_media_received') {
    // Pièce jointe / note vocale reçue du téléphone sur le canal mina_app. Rien du binaire n'est
    // affiché ; on annonce l'arrivée et, si Mina a compris (vision/transcription), sa légende.
    const label = event.kind === 'voice' ? 'note vocale' : event.kind === 'image' ? 'image' : 'fichier';
    if (event.readable === false) {
      log(`Téléphone : ${label} reçue mais illisible — rien gardé.`);
    } else if (event.caption) {
      log(`Téléphone : ${label} reçue. ${event.caption}`);
      if (event.kind === 'image') void say(event.caption);
    } else {
      log(`Téléphone : ${label} reçue et gardée (analyse indisponible).`);
    }
  }
});

// One spoken heads-up per rough retry burst — a flaky network can emit many retries in seconds
// and Mina must not chant "je réessaie" over and over.
let lastRetryAnnouncement = 0;
const announceRetryOnce = () => {
  const now = Date.now();
  if (now - lastRetryAnnouncement < 30_000) return;
  lastRetryAnnouncement = now;
  void say('Petit souci technique, je réessaie.');
};
// C3 — service de décodage audio pour la transcription locale : le main envoie une note vocale
// m4a (base64), Chromium la décode (AAC), on ré-échantillonne en 16 kHz mono (format Whisper) et
// on renvoie le PCM. Tout reste dans le processus — aucun octet ne quitte la machine.
api.onDecodeAudioRequest?.(async (request) => {
  const reply = { requestId: request?.requestId ?? null, pcm: null, sampleRate: 16_000, error: null };
  try {
    const binary = atob(String(request?.bytesBase64 ?? ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const probe = new AudioContext();
    const decoded = await probe.decodeAudioData(bytes.buffer);
    await probe.close();
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16_000), 16_000);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start(0);
    const resampled = await offline.startRendering();
    reply.pcm = Array.from(resampled.getChannelData(0));
  } catch (error) {
    reply.error = String(error?.message ?? error).slice(0, 200);
  }
  api.replyDecodedAudio?.(reply);
});

api.onVoiceWake((phrase) => {
  voicePresence.dispatch({ type: 'capture_started' });
  setStatus('Mina activée', 'ready', true);
  log(`Activation entendue : ${phrase}. Dites maintenant votre instruction.`);
});
// Runs one utterance through the deterministic dialogue layer and executes its intent.
// Returns true when the dialogue owned the turn (reply or action), false when nothing matched.
// Dedup between the two understanding layers: the deterministic text layer usually fires first
// (~1s after silence), the Gemini live tool call for the SAME sentence arrives moments later.
// Whoever executes a kind stamps it; the other side skips the kind for a short window.
const intentStamps = new Map();
const stampIntent = (kind) => intentStamps.set(kind, Date.now());
const intentJustHandled = (kind, windowMs = 6_000) => (Date.now() - (intentStamps.get(kind) ?? 0)) < windowMs;

// "Que sais-tu faire ?" answered from the REAL runtime state (installed skills, sandbox, phone) —
// the hardcoded text only survives as a fallback when the state probe itself fails.
const describeCapabilities = async () => {
  stampIntent('describe');
  try {
    const snapshot = await api.capabilities();
    const brief = composeCapabilityBrief(snapshot);
    log('Mina : description des capacités depuis l’état réel.');
    void say(brief);
  } catch (error) {
    log(`Capacités : ${error.message} — description générique.`);
    void say(SELF_KNOWLEDGE_FALLBACK);
  }
};

// « Trouve-moi un article » : réponse web directe lue à voix haute — jamais de navigateur.
// Les sources restent dans le journal (URL complètes) ; la voix ne lit que les titres.
const runWebAnswer = async (query) => {
  stampIntent('web');
  log(`Recherche web directe : ${query}`);
  try {
    const result = await api.webAnswer({ query });
    for (const source of result.sources) log(`Source web : ${source.title || source.url} — ${source.url}`);
    const titles = result.sources.map((source) => source.title).filter(Boolean);
    void say(titles.length ? `${result.text} Mes sources : ${titles.join(', ')}.` : result.text);
  } catch (error) {
    void reportTechnicalError('research', 'web_answer_failed', error);
    log(`Recherche web : ${error.message}`);
    // 429 = quota gratuit Gemini du moment (partagé avec la session vocale) — le dire honnêtement
    // vaut mieux qu'un échec générique qui ressemble à une panne.
    // ⚠️ Formulations volontairement SANS verbe mission ni mot surface (« recherche/ouvrir » +
    // « web/navigateur ») : l'ancienne phrase d'échec revenait en écho micro et RELANÇAIT une
    // mission navigateur fantôme (journal réel 2026-07-25, 22:31:16 → 22:31:21). Contrat :
    // tests/spoken-lines-echo-safe.test.mjs.
    void say(String(error?.message ?? '').includes('web_answer_http_429')
      ? "Mon quota gratuit d'infos en ligne est épuisé pour le moment. Réessayez dans quelques minutes."
      : "Je n'ai pas réussi à obtenir la réponse en ligne. Réessayez dans un instant.");
  }
};

// « Qu'as-tu fait ? » : résumé parlé composé depuis le journal PERSISTANT — la vérité factuelle,
// jamais un souvenir improvisé. En mode Gemini, l'outil lire_journal donne le détail complet.
const runJournalBrief = async () => {
  stampIntent('journal');
  try {
    const entries = await api.readJournal({ limit: 30 });
    log(`Journal : ${entries.length} événement(s) relus.`);
    void say(composeJournalBrief(entries));
  } catch (error) {
    void reportTechnicalError('journal', 'journal_read_failed', error);
    void say("Je n'arrive pas à relire mon journal pour le moment.");
  }
};

const executeDialogueAction = (action) => {
  if (action?.type === 'open_camera') { stampIntent('camera'); void openCameraFromDialogue(action.context); }
  else if (action?.type === 'decline_camera') { stampIntent('camera'); void declineCameraFromDialogue(); }
  else if (action?.type === 'set_theme') { stampIntent('theme'); applyTheme(action.theme); }
  else if (action?.type === 'select_environment') {
    stampIntent('environment');
    const environment = selectEnvironment(action.environment);
    log(`Surface active : ${environment}.`);
  }
  else if (action?.type === 'play_music') { stampIntent('mission'); playMusicFromDialogue(action.query); }
  else if (action?.type === 'connect_google_browser') {
    stampIntent('google_login');
    api.connectGoogleBrowser()
      .then(() => log('Connexion Google : Chrome normal ouvert avec le profil persistant Mina Vision.'))
      .catch((error) => log(`Connexion Google : ${error.message}`));
  }
  else if (action?.type === 'close_browser' || action?.type === 'change_music') {
    stampIntent('close_browser');
    mediaSessionActive = false;
    api.closeBrowser().catch((error) => log(`Fermeture navigateur : ${error.message}`));
  } else if (action?.type === 'flip_camera') { stampIntent('camera'); void flipCameraLens(); }
  else if (action?.type === 'start_mission') {
    stampIntent('mission');
    if (/youtube|musique|chanson|video|film/iu.test(action.goal)) mediaSessionActive = true;
    void startOrGuideMission(action.goal, action.environment);
  } else if (action?.type === 'media_followup') {
    stampIntent('mission');
    mediaSessionActive = true;
    const contextGoal = `Dans l'onglet déjà ouvert du navigateur (YouTube ou lecteur en cours), exécute : ${action.command}. `
      + "N'ouvre ni nouvel onglet ni nouvelle recherche Google — agis directement sur la page actuelle (lecteur, résultats déjà affichés).";
    void startOrGuideMission(contextGoal, 'browser');
  } else if (action?.type === 'describe_capabilities') void describeCapabilities();
  else if (action?.type === 'web_search') void runWebAnswer(action.query);
  else if (action?.type === 'read_journal') void runJournalBrief();
};

const applyDialogueDecision = (utterance) => {
  const decision = dialogue.interpret(utterance, { ...dialogueState, mediaSessionActive });
  dialogueState = decision.state;
  if (!decision.reply && !decision.action) return false;
  if (decision.reply) { log(`Mina : ${decision.reply}`); void say(decision.reply); }
  executeDialogueAction(decision.action);
  return true;
};

// Structured intents from the Gemini live session (dynamic understanding of ANY phrasing).
// Skipped when the deterministic layer just handled the same kind — otherwise executed through
// the exact same action paths, so safety confirmations and verification stay identical.
api.onVoiceIntent((intent) => {
  const name = intent?.name;
  const args = intent?.args ?? {};
  if (name === 'lancer_mission') {
    if (intentJustHandled('mission') || intentJustHandled('environment')) return;
    const goal = String(args.objectif ?? '').trim();
    if (!goal) return;
    log(`Intention Gemini : mission — ${goal}`);
    executeDialogueAction({
      type: 'start_mission',
      environment: ['browser', 'desktop', 'mobile'].includes(args.environnement) ? args.environnement : selectedEnvironment(),
      goal,
    });
  } else if (name === 'selectionner_environnement') {
    if (intentJustHandled('environment')) return;
    if (!['browser', 'desktop', 'mobile'].includes(args.environnement)) return;
    executeDialogueAction({ type: 'select_environment', environment: args.environnement });
  } else if (name === 'piloter_page') {
    if (intentJustHandled('mission')) return;
    const command = String(args.commande ?? '').trim();
    if (!command) return;
    log(`Intention Gemini : pilotage page — ${command}`);
    executeDialogueAction({ type: 'media_followup', command });
  } else if (name === 'jouer_musique') {
    if (intentJustHandled('mission')) return;
    const titre = String(args.titre ?? '').trim();
    if (!titre) return;
    log(`Intention Gemini : musique — ${titre}`);
    executeDialogueAction({ type: 'play_music', query: titre });
  } else if (name === 'camera') {
    if (intentJustHandled('camera')) return;
    log(`Intention Gemini : caméra — ${args.action}`);
    if (args.action === 'ouvrir') executeDialogueAction({ type: 'open_camera' });
    else if (args.action === 'fermer') executeDialogueAction({ type: 'decline_camera' });
    else if (args.action === 'inverser') executeDialogueAction({ type: 'flip_camera' });
  } else if (name === 'theme') {
    if (intentJustHandled('theme')) return;
    executeDialogueAction({ type: 'set_theme', theme: args.mode === 'nuit' ? 'dark' : 'light' });
  } else if (name === 'fermer_navigateur') {
    if (intentJustHandled('close_browser')) return;
    executeDialogueAction({ type: 'close_browser' });
  } else if (name === 'connecter_gmail_navigateur') {
    if (intentJustHandled('google_login')) return;
    executeDialogueAction({ type: 'connect_google_browser' });
  } else if (name === 'decrire_capacites') {
    if (intentJustHandled('describe')) return;
    void describeCapabilities();
  } else if (name === 'recherche_web') {
    if (intentJustHandled('web')) return;
    const requete = String(args.requete ?? '').trim();
    if (!requete) return;
    log(`Intention Gemini : recherche web — ${requete}`);
    void runWebAnswer(requete);
  }
});

// Voice while a mission is already running = steering for THAT mission (same window, mouse and
// keyboard), never a competing second mission. Falls back to a fresh mission when nothing runs
// (or the running one just finished between the check and the queue attempt).
// Repeating the same sentence within a few seconds (impatience while the mission spins up) is
// dropped instead of piling identical guidance onto the queue.
let lastMissionRequest = { goal: '', at: 0 };
const startOrGuideMission = async (goal, environment) => {
  const activeEnvironment = environment ? selectEnvironment(environment) : selectedEnvironment();
  const now = Date.now();
  const normalizedGoal = String(goal).trim().toLocaleLowerCase('fr-FR');
  if (normalizedGoal && normalizedGoal === lastMissionRequest.goal && now - lastMissionRequest.at < 8_000) {
    log(`Répétition ignorée (déjà en route) : ${goal}`);
    return;
  }
  lastMissionRequest = { goal: normalizedGoal, at: now };
  if (busy) {
    try {
      const result = await api.guideMission(goal);
      if (result?.queued) {
        log(`Mission en cours — instruction transmise : ${goal}`);
        return;
      }
    } catch { /* fall through to a fresh mission */ }
  }
  elements.goal.value = goal;
  log(`Mission vocale (${activeEnvironment}) : ${goal}`);
  void startMission(goal, activeEnvironment);
};

api.onVoiceCommand((command) => {
  // Mina's deterministic persona/consent layer owns matched turns — no computer-use mission.
  if (applyDialogueDecision(command)) return;
  void startOrGuideMission(command);
});
// Everything the wake router ignores still reaches the dialogue layer (consent "oui", "active la
// caméra", musique, thème…) — but with NO mission fallback: unmatched casual speech does nothing.
api.onVoiceDialogue((utterance) => { applyDialogueDecision(utterance); });
api.onVoiceTranscript((transcript) => {
  voicePresence.dispatch({ type: 'transcript_final' });
  log(`Voix entendue : ${transcript}`);
});
api.onVoiceAudio((payload) => {
  voicePresence.dispatch({ type: 'audio_chunk' });
  void playPcm24(payload);
});
// Mot d'arrêt explicite (« stop », « chut », « tais-toi ») : coupure IMMÉDIATE et inconditionnelle
// de la lecture — ce canal contourne volontairement la fenêtre anti-écho ci-dessous, qui avalait
// les interruptions prononcées juste après le début d'une réponse.
api.onVoiceStopSpeech?.(() => {
  log('Stop — Mina se tait.');
  // Un stop EXPLICITE tue aussi le retry anti-écho : sans ça, l'interruption serveur qui suit
  // le stop tombait dans la fenêtre de grâce d'une LECTURE ([DIS]) et la ligne était REJOUÉE —
  // « elle ne s'arrête pas quand je dis stop en début de lecture » (cas réel 2026-07-22).
  lastReadbackAt = 0;
  readbackRetryUsed = true;
  stopVoicePlayback();
});

api.onVoiceInterrupted(() => {
  // Ignore an interruption that lands inside the grace window after we asked Mina to speak —
  // that one is almost always the owner's own trailing audio/echo, not a real interruption.
  const sinceReadback = Date.now() - lastReadbackAt;
  if (sinceReadback < READBACK_GRACE_MS) {
    // The server already discarded the rest of the readback — merely « continuing » plays silence.
    // Re-send the exact same line once; by then the echo of the question is gone.
    if (!readbackRetryUsed && lastReadbackText) {
      readbackRetryUsed = true;
      lastReadbackAt = Date.now(); // the retry opens its own grace window against a second echo
      playbackSuppressedAt = 0;
      log('Écho détecté — je répète ma réponse.');
      void api.sayVoice(lastReadbackText).catch(() => { speak(lastReadbackText); });
      return;
    }
    log('Interruption ignorée (écho de votre question, Mina continue).');
    return;
  }
  // Logged explicitly: if Mina keeps getting cut mid-sentence while nobody is speaking, this line
  // appearing in the journal is the proof it came from the server VAD (mic echo), not a bug in the
  // audio pipeline — which is otherwise indistinguishable from the outside.
  if (scheduledVoiceSources.size > 0) log(`Parole coupée par une interruption détectée (${Math.round(sinceReadback / 1000)}s après le début).`);
  stopVoicePlayback();
});

// Reprise de session (coupure réseau en pleine réponse) : on jette le reliquat audio du tour
// interrompu AVANT que Gemini ne rejoue le tour — sinon le flux rejoué s'empile sur la file locale
// et Mina répète le début de sa phrase. Vidage INCONDITIONNEL, sans re-dire (contrairement à
// voice-interrupted qui, dans sa fenêtre de grâce, peut relancer une réplique).
api.onVoiceDropPlayback?.(() => {
  stopVoicePlayback();
});

api.status().then((status) => {
  applyStatusFromHealth(status);
  if (status.ok) elements.dentalMode.textContent = status.config.dryRun ? "Aperçu, rien n'est modifié" : 'Sélection avec confirmation';
}).catch((error) => {
  setStatus('Configuration invalide', 'blocked');
  elements.lockPanel.hidden = false;
  elements.lockText.textContent = error.message;
});
elements.sms.addEventListener('click', async () => {
  const sourceMessageId = window.prompt('Identifiant du SMS reçu auquel répondre :');
  if (!sourceMessageId) return;
  const recipientE164 = window.prompt('Numéro destinataire au format E.164 (ex. +336…) :');
  if (!recipientE164) return;
  const text = window.prompt('Réponse SMS :');
  if (!text) return;
  try {
    const receipt = await api.sendSmsConfirmed({ sourceMessageId, recipientE164, text });
    log(`SMS remis à Android (${receipt.id}). Livraison au destinataire non encore prouvée.`);
  } catch (error) {
    log(`SMS bloqué : ${error.message}`);
  }
});
elements.phoneSync.addEventListener('click', async () => {
  try {
    const result = await api.syncPhoneMessages();
    log(`Messages synchronisés : ${result.stored} mémorisé(s), ${result.acked} acquitté(s).`);
  } catch (error) {
    // Cause n°1 quand « ça ne marche pas » : la mémoire est verrouillée (la sync écrit dans le
    // coffre chiffré). Message actionnable plutôt qu'un code brut.
    const msg = /memory_locked/u.test(error.message)
      ? 'Déverrouille d’abord la mémoire (onglet Config → Mémoire) : la synchronisation y écrit.'
      : /identité|autoris|détect|gateway/iu.test(error.message)
        ? `Aucun téléphone Mina prêt : ${error.message}. Vérifie l’appairage et l’ADB (USB ou Wi-Fi).`
        : error.message;
    log(`Synchronisation messages : ${msg}`);
  }
});
elements.settingsSave.addEventListener('click', async () => {
  if (!settingsSchema) return;
  const patch = {
    MINA_INFERENCE_MODE: elements.settingsMode.value,
    MINA_OFFLINE: elements.settingsOffline.checked,
  };
  elements.settingsFields.querySelectorAll('[data-env-key]').forEach((input) => {
    patch[input.dataset.envKey] = input.type === 'checkbox' ? input.checked : input.value;
  });
  try {
    await api.updateSettings(patch);
    log('Configuration non sensible enregistrée dans .env ; runtime rechargé au prochain appel.');
    await refreshSettings();
  } catch (error) { log(`Paramètres : ${error.message}`); }
});
const refreshSmsPolicyStatus = async () => {
  try {
    const { mode } = await api.smsPolicyStatus();
    elements.smsPolicyStatus.textContent = `Mode actuel : ${mode}`;
  } catch { /* SMS policy status is best-effort */ }
};
elements.smsPolicyRevoke.addEventListener('click', async () => {
  await api.smsPolicyRevoke();
  log('Arrêt d’urgence SMS auto activé : confirmation systématique jusqu’à réactivation.');
  await refreshSmsPolicyStatus();
});
elements.smsPolicyReactivate.addEventListener('click', async () => {
  await api.smsPolicyReactivate();
  log('Envoi SMS automatique réactivé selon le mode configuré.');
  await refreshSmsPolicyStatus();
});
void refreshSmsPolicyStatus();
elements.analyticsRefresh.addEventListener('click', () => { void refreshAnalytics().catch((error) => log(`Analyses : ${error.message}`)); });
elements.automationRefresh.addEventListener('click', () => { void refreshAutomationStatus().catch((error) => log(`Automatisations : ${error.message}`)); });
elements.extensionsRefresh.addEventListener('click', () => { void refreshExtensionsStatus().catch((error) => log(`Extensions : ${error.message}`)); });
elements.todayRefresh.addEventListener('click', () => { void refreshToday().catch((error) => log(`Aujourd’hui : ${error.message}`)); });
const exportAnalytics = async (format) => {
  try {
    const result = await api.exportAnalytics({ ...analyticsRequest(), format });
    log(`Analyses exportées : ${result.rows} ligne(s).`);
  } catch (error) { log(`Export analyses : ${error.message}`); }
};
elements.analyticsExportCsv.addEventListener('click', () => { void exportAnalytics('csv'); });
elements.analyticsExportJson.addEventListener('click', () => { void exportAnalytics('json'); });
elements.memoryInitialize.addEventListener('click', async () => {
  try {
    const state = await api.initializeMemory();
    updateMemoryStatus(state);
    elements.recoveryOutput.hidden = false;
    elements.recoveryOutput.textContent = `À conserver hors du PC — affichée une seule fois :\n${state.recoveryPhrase}`;
    log('Mémoire Mina Vision initialisée et déverrouillée. Sauvegardez la phrase de récupération hors du PC.');
  } catch (error) {
    log(`Mémoire : ${error.message}`);
  }
});
elements.memoryUnlock.addEventListener('click', async () => {
  try {
    const phrase = elements.recoveryPhrase.value.trim();
    const state = await api.unlockMemory(phrase ? { recoveryPhrase: phrase } : undefined);
    elements.recoveryPhrase.value = '';
    updateMemoryStatus(state);
    log('Mémoire Mina Vision déverrouillée.');
  } catch (error) {
    log(`Mémoire : ${error.message}`);
  }
});
// Droit à l'oubli : suppression DÉFINITIVE, propagée aux sauvegardes. Le main process exige
// une confirmation locale ; l'UI ne fait que proposer le critère.
document.querySelector('#memory-forget')?.addEventListener('click', async () => {
  const criteria = document.querySelector('#forget-criteria')?.value?.trim();
  if (!criteria) {
    log('Oubli : indiquez ce que Mina doit oublier.');
    return;
  }
  try {
    const result = await api.proposeForget({ criteria });
    log(result?.forgotten === false
      ? 'Oubli annulé : confirmation refusée.'
      : `Oubli effectué : ${criteria}.`);
    const field = document.querySelector('#forget-criteria');
    if (field) field.value = '';
  } catch (error) {
    log(`Oubli : ${error.message}`);
  }
});
elements.memoryLock.addEventListener('click', async () => {
  updateMemoryStatus(await api.lockMemory());
  elements.memoryResults.textContent = '';
  log('Mémoire Mina Vision verrouillée.');
});
elements.memorySearch.addEventListener('click', async () => {
  try {
    const result = await api.searchMemory({ query: elements.memoryQuery.value, revealSensitive: false });
    renderMemoryItems(result.items);
    updateMemoryStatus(await api.memoryStatus());
  } catch (error) {
    log(`Recherche mémoire : ${error.message}`);
  }
});
elements.fileRead.addEventListener('click', async () => {
  try {
    const output = await api.readFile({ path: elements.filePath.value, operation: 'read' });
    renderMemoryItems(output.evidence, 'evidence');
    updateMemoryStatus(await api.memoryStatus());
  } catch (error) {
    log(`Lecture fichier : ${error.message}`);
  }
});
elements.webRead.addEventListener('click', async () => {
  try {
    const output = await api.readWeb({ url: elements.webUrl.value, operation: 'read' });
    renderMemoryItems(output.evidence, 'evidence');
    updateMemoryStatus(await api.memoryStatus());
  } catch (error) {
    log(`Lecture web : ${error.message}`);
  }
});
elements.chooseSkill.addEventListener('click', async () => {
  try {
    const staged = await api.chooseAndStageSkill();
    if (staged.canceled) return;
    stagedQuarantineId = staged.quarantineId;
    elements.installSkill.disabled = false;
    elements.quarantineReport.hidden = false;
    elements.quarantineReport.textContent = JSON.stringify(staged.report, null, 2);
    log(`Skill audité en quarantaine : ${staged.report?.name || staged.quarantineId}.`);
  } catch (error) {
    stagedQuarantineId = null;
    elements.installSkill.disabled = true;
    log(`Audit skill : ${error.message}`);
  }
});
elements.installSkill.addEventListener('click', async () => {
  if (!stagedQuarantineId) return;
  try {
    const result = await api.installSkill({ quarantineId: stagedQuarantineId });
    stagedQuarantineId = null;
    elements.installSkill.disabled = true;
    elements.quarantineReport.hidden = true;
    log(`Skill installé : ${result.name} ${result.version || ''}.`);
    await refreshSkillsSandbox();
  } catch (error) {
    log(`Installation skill : ${error.message}`);
  }
});

api.onSandboxEvent((event) => {
  const item = document.createElement('li');
  item.textContent = `${timeLabel()} · ${event?.type || 'event'} · ${event?.message || event?.jobId || ''}`;
  elements.sandboxStream.prepend(item);
  while (elements.sandboxStream.children.length > 100) elements.sandboxStream.lastElementChild.remove();
});

api.onTechnicalLog((entry) => renderTechnicalEntry(entry));
elements.technicalLogClear.addEventListener('click', async () => {
  await api.clearTechnicalLogs();
  showEmptyTechnicalLog();
});

Promise.all([api.sessionState(), api.groundingStatus()]).then(([sessionState, grounding]) => {
  if (sessionState?.runtimeStatus === 'ready') {
    log(`Sessions prêtes · ${grounding?.total ?? 0} affirmation(s) suivie(s).`);
  }
}).catch(() => {});

// Démarrage automatique Windows : la case reflète TOUJOURS l'état réel relu depuis Windows —
// jamais l'intention. Si Windows refuse le réglage, la case revient et le dit.
const startupState = document.querySelector('#startup-state');
const startupEnabled = document.querySelector('#startup-enabled');
const renderStartup = (state) => {
  if (!startupEnabled || !startupState) return;
  startupEnabled.checked = state?.enabled === true;
  startupEnabled.disabled = state?.supported === false;
  startupState.textContent = state?.supported === false
    ? 'Non pris en charge'
    : state?.enabled ? 'Activé' : 'Désactivé';
  startupState.className = state?.enabled ? 'badge ready' : 'badge';
};
const refreshStartup = async () => renderStartup(await api.startupStatus());
startupEnabled?.addEventListener('change', async () => {
  const wanted = startupEnabled.checked;
  try {
    const result = await api.setStartup(wanted);
    renderStartup({ ...result, supported: true });
    log(result.applied
      ? `Démarrage avec Windows : ${result.enabled ? 'activé' : 'désactivé'}.`
      : `Démarrage avec Windows : Windows n'a pas appliqué le réglage (demandé ${wanted ? 'activé' : 'désactivé'}).`);
  } catch (error) {
    log(`Démarrage Windows : ${error.message}`);
    await refreshStartup().catch(() => {});
  }
});

// Catalogue de vérité : état réel de chaque domaine, avec la raison exacte d'une indisponibilité.
const CAPABILITY_LABELS = { available: 'disponible', degraded: 'dégradé', unavailable: 'indisponible' };
const renderCapabilities = (entries) => {
  const list = document.querySelector('#capabilities-list');
  if (!list) return;
  list.textContent = '';
  if (!Array.isArray(entries) || entries.length === 0) {
    const empty = document.createElement('li');
    empty.textContent = 'Aucune capacité publiée pour le moment.';
    list.append(empty);
    return;
  }
  for (const entry of entries) {
    const item = document.createElement('li');
    const name = document.createElement('strong');
    name.textContent = entry.id;
    const badge = document.createElement('span');
    badge.className = entry.status === 'available' ? 'badge ready'
      : entry.status === 'degraded' ? 'badge warning' : 'badge blocked';
    badge.textContent = CAPABILITY_LABELS[entry.status] ?? entry.status;
    item.append(name, ' ', badge);
    // Cercle de maturité (T0.2) : à côté de l'état runtime, on montre si le domaine est cœur,
    // maintenu ou expérimental. Un domaine gelé porte un badge d'avertissement explicite pour
    // que « expérimental — non vérifié en usage réel » soit lisible, pas déduit.
    const circle = describeCircle(entry.id);
    const circleBadge = document.createElement('span');
    circleBadge.className = circle.experimental ? 'badge warning' : 'badge muted';
    circleBadge.textContent = circle.label;
    circleBadge.title = circle.note;
    item.append(' ', circleBadge);
    if (circle.experimental) {
      const warn = document.createElement('span');
      warn.className = 'muted';
      warn.textContent = ` — ${circle.note}`;
      item.append(warn);
    }
    if (entry.reason) {
      const reason = document.createElement('span');
      reason.className = 'muted';
      reason.textContent = ` — ${entry.reason}`;
      item.append(reason);
    }
    list.append(item);
  }
};
// Catalogue COMPLET (conscience de Mina) : readiness, santé, outils et réglages non sensibles,
// rendus EN TÊTE de la liste des capacités — la même vérité que decrire_capacites à la voix.
const renderCapabilityCatalog = (catalog) => {
  const list = document.querySelector('#capabilities-list');
  if (!list || !catalog) return;
  const prepend = (label, text, badgeClass = null) => {
    const item = document.createElement('li');
    const name = document.createElement('strong');
    name.textContent = label;
    item.append(name);
    if (badgeClass) {
      const badge = document.createElement('span');
      badge.className = badgeClass;
      badge.textContent = text;
      item.append(' ', badge);
    } else {
      const span = document.createElement('span');
      span.className = 'muted';
      span.textContent = ` ${text}`;
      item.append(span);
    }
    list.prepend(item);
  };
  const settings = catalog.settings;
  if (settings) {
    const providers = Object.entries(settings.providers ?? {})
      .filter(([, value]) => value?.enabled)
      .map(([name, value]) => (value.model ? `${name} (${value.model})` : name));
    prepend('Réglages actifs', `inférence ${settings.inferenceMode ?? '?'}${settings.offline ? ' · hors-ligne' : ''}`
      + ` · appels ${settings.callMode ?? '?'} · SMS ${settings.smsSendMode ?? '?'}`
      + (providers.length ? ` · ${providers.join(', ')}` : ''));
  }
  const tools = catalog.capabilities?.tools ?? [];
  if (tools.length) prepend('Outils vocaux', `${tools.length} fonctions : ${tools.map((tool) => tool.name).join(', ')}`);
  for (const issue of [...(catalog.health ?? [])].reverse()) {
    prepend(`Santé · ${issue.id}`, `${issue.level}${issue.detail ? ` — ${issue.detail}` : ''}`,
      issue.level === 'unavailable' || issue.level === 'locked' ? 'badge blocked' : 'badge warning');
  }
  const readiness = catalog.readiness ?? {};
  prepend('Prête à agir', [
    readiness.missionReady ? 'missions ✓' : 'missions —',
    readiness.memoryUnlocked ? 'mémoire ✓' : 'mémoire verrouillée',
    readiness.phoneConnected ? 'téléphone ✓' : 'téléphone hors ligne',
    readiness.sandboxAvailable ? 'sandbox ✓' : 'sandbox indisponible',
  ].join(' · '));
};
// Canal `mina_app` : etat reel du serveur, appareils appaires, code d'appairage.
// Aucun contenu de conversation n'est lu ici — l'ecran ne sert qu'a decider qui a le droit
// de parler a Mina depuis un telephone.
const renderChatChannel = (status) => {
  const state = document.querySelector('#chat-channel-state');
  if (state) {
    if (!status || status.listening !== true) {
      state.textContent = status?.vaultUnlocked === false
        ? 'Canal ferme — memoire verrouillee. Deverrouillez la memoire pour que le telephone puisse joindre Mina.'
        : `Canal ferme${status?.lastError ? ` — ${status.lastError}` : ''}.`;
    } else {
      const connected = Array.isArray(status.connectedDevices) ? status.connectedDevices.length : 0;
      state.textContent = `A l'ecoute sur ${status.address} — epoque de cle ${status.keyEpoch}, ${connected} appareil(s) connecte(s).`;
    }
  }
  const connectedSet = new Set(Array.isArray(status?.connectedDevices) ? status.connectedDevices : []);
  renderList(
    '#chat-devices',
    (status?.devices ?? []).map((device) => ({ ...device, connected: connectedSet.has(device.deviceId) })),
    chatDeviceRow,
    { empty: 'Aucun telephone appaire.' },
  );
};

const refreshChatChannel = async () => {
  if (!api.chatStatus) return;
  renderChatChannel(await api.chatStatus());
};

document.querySelector('#chat-pairing-open')?.addEventListener('click', () => {
  api.chatOpenPairing()
    .then((result) => {
      const target = document.querySelector('#chat-pairing-code');
      if (!target) return;
      target.textContent = result?.ok
        ? `Code d'appairage : ${result.code} — valable jusqu'a ${new Date(result.expiresAtMs).toLocaleTimeString('fr-FR')}, une seule fois.`
        : `Appairage impossible : ${result?.reason ?? 'raison inconnue'}.`;
    })
    .then(refreshChatChannel)
    .catch((error) => log(`Appairage telephone : ${error.message}`));
});

document.querySelector('#chat-pairing-close')?.addEventListener('click', () => {
  api.chatClosePairing()
    .then(() => {
      const target = document.querySelector('#chat-pairing-code');
      if (target) target.textContent = 'Appairage ferme.';
    })
    .then(refreshChatChannel)
    .catch((error) => log(`Appairage telephone : ${error.message}`));
});

document.querySelector('#chat-devices')?.addEventListener('click', (event) => {
  const sendButton = event.target.closest('button[data-action="chat-send-file"]');
  if (sendButton) {
    // W6 : la boîte système choisit le fichier (jamais un chemin arbitraire du renderer) ;
    // l'envoi part chiffré en chunks sur la session active de l'appareil.
    api.chatSendFile?.(sendButton.dataset.value)
      .then((result) => log(result?.ok
        ? `Fichier envoye au telephone (${result.chunkCount} morceau(x), ${Math.round((result.sizeBytes ?? 0) / 1024)} Ko).`
        : `Envoi refuse : ${result?.reason ?? 'raison inconnue'}.`))
      .catch((error) => log(`Envoi fichier : ${error.message}`));
    return;
  }
  const button = event.target.closest('button[data-action="chat-revoke"]');
  if (!button) return;
  api.chatRevokeDevice(button.dataset.value)
    .then((result) => log(result?.ok
      ? `Appareil revoque — nouvelle epoque de cle ${result.keyEpoch}.`
      : `Revocation refusee : ${result?.reason ?? 'raison inconnue'}.`))
    .then(refreshChatChannel)
    .catch((error) => log(`Revocation : ${error.message}`));
});

const refreshCapabilities = async () => {
  renderCapabilities(await api.capabilitiesList());
  // Catalogue complet en fail-soft : une panne du catalogue ne casse jamais la liste runtime.
  try { renderCapabilityCatalog(await api.capabilityCatalog?.()); } catch { /* liste runtime déjà affichée */ }
};
document.querySelector('#capabilities-refresh')?.addEventListener('click', () => {
  Promise.all([refreshCapabilities(), refreshStartup(), refreshChatChannel()])
    .catch((error) => log(`État système : ${error.message}`));
});

// Panneaux de domaine : e-mail, organisation personnelle, impression, maison, personnalité.
// Chaque domaine dit la VÉRITÉ — un domaine non composé affiche « indisponible » avec sa
// raison plutôt qu'une liste vide qui laisserait croire à un état sain.
const failed = (target) => (error) => renderUnavailable(target, String(error?.message ?? error).slice(0, 160));

const refreshMail = async () => {
  const accounts = await api.listMailAccounts();
  renderList('#mail-accounts', accounts, mailAccountRow, { empty: 'Aucun compte e-mail connecté.' });
};
document.querySelector('#mail-refresh')?.addEventListener('click', () => {
  refreshMail().catch(failed('#mail-accounts'));
});
document.querySelector('#mail-search')?.addEventListener('click', async () => {
  const query = document.querySelector('#mail-query')?.value ?? '';
  try {
    const results = await api.searchMail({ query });
    renderList('#mail-results', results?.messages ?? results, mailMessageRow, { empty: 'Aucun message trouvé.' });
  } catch (error) {
    renderUnavailable('#mail-results', String(error?.message ?? error).slice(0, 160));
  }
});

const refreshPersonal = async () => {
  await Promise.all([
    api.personalTasks()
      .then((tasks) => renderList('#personal-tasks', tasks, taskRow, { empty: 'Aucune tâche.' }))
      .catch(failed('#personal-tasks')),
    api.routinesList()
      .then((routines) => renderList('#personal-routines', routines, routineRow, { empty: 'Aucune routine.' }))
      .catch(failed('#personal-routines')),
    api.graphListContacts()
      .then((contacts) => renderList('#personal-contacts', contacts, contactRow, { empty: 'Aucun contact.' }))
      .catch(failed('#personal-contacts')),
  ]);
};
document.querySelector('#personal-refresh')?.addEventListener('click', () => {
  refreshPersonal().catch(() => {});
});
// Briefing du jour : identityId explicite (le service l'exige — jamais deviné côté UI).
document.querySelector('#personal-briefing-button')?.addEventListener('click', async () => {
  try {
    const briefing = await api.personalBriefing({ identityId: 'owner' });
    renderList('#personal-briefing', briefing?.items ?? [], (entry) => ({
      text: entry?.title ?? entry?.summary ?? 'élément',
      badge: entry?.stale === true ? 'obsolète' : null,
      badgeClass: 'badge warning',
      muted: entry?.source ?? null,
    }), { empty: 'Rien de notable aujourd’hui.' });
  } catch (error) {
    renderUnavailable('#personal-briefing', String(error?.message ?? error).slice(0, 160));
  }
});

const refreshPrinting = async () => {
  const printers = await api.discoverPrinters();
  renderList('#printing-list', printers, printerRow, { empty: 'Aucune imprimante détectée.' });
};
document.querySelector('#printing-discover')?.addEventListener('click', () => {
  refreshPrinting().catch(failed('#printing-list'));
});
// Imprimer un fichier : le main process vérifie que l'imprimante est AUTORISÉE, demande une
// confirmation, puis vérifie l'acceptation réelle dans la file Windows.
document.querySelector('#print-file-send')?.addEventListener('click', async () => {
  const printerId = document.querySelector('#printer-id')?.value?.trim();
  const filePath = document.querySelector('#print-file-path')?.value?.trim();
  if (!printerId || !filePath) {
    log('Impression : indiquez l’imprimante ET le chemin du fichier.');
    return;
  }
  try {
    const job = await api.printFile({ printerId, filePath, copies: 1 });
    log(`Impression : ${job?.status ?? 'envoyée'} (${filePath}).`);
  } catch (error) {
    log(`Impression : ${error.message}`);
  }
});
// Autoriser une imprimante : action à effet — passe par la confirmation locale du main process.
document.querySelector('#printer-approve')?.addEventListener('click', async () => {
  const printerId = document.querySelector('#printer-id')?.value?.trim();
  if (!printerId) {
    log('Impression : indiquez le nom exact de l’imprimante.');
    return;
  }
  try {
    await api.approvePrinter(printerId);
    log(`Imprimante autorisée : ${printerId}.`);
    await refreshPrinting().catch(() => {});
  } catch (error) {
    log(`Impression : ${error.message}`);
  }
});

const refreshHome = async () => {
  // connectorHealth() est l'état RÉEL des connecteurs ; auditHistory(commandId) sert à relire
  // le reçu d'UNE commande précise et n'est donc pas un historique global (contrat vérifié
  // sur le controller — appel sans argument = home_ui_request_invalid).
  const [devices, health] = await Promise.all([api.listHomeDevices(), api.homeConnectorHealth()]);
  renderList('#home-devices', devices, homeDeviceRow, { empty: 'Aucun appareil enregistré.' });
  renderList('#home-audit', Object.entries(health ?? {}), ([id, state]) => ({
    text: id,
    badge: state?.available === true ? 'disponible' : 'indisponible',
    badgeClass: state?.available === true ? 'badge ready' : 'badge warning',
    muted: state?.reason ?? null,
  }), { empty: 'Aucun connecteur configuré.' });
  const state = document.querySelector('#home-state');
  if (state) {
    const count = Array.isArray(devices) ? devices.length : 0;
    state.textContent = count > 0 ? `${count} appareil(s)` : 'aucun connecteur';
    state.className = count > 0 ? 'badge ready' : 'badge warning';
  }
};
document.querySelector('#home-refresh')?.addEventListener('click', () => {
  refreshHome().catch(failed('#home-devices'));
});
// Piloter un appareil : action à EFFET réel — la politique maison et le broker décident, l'UI
// ne fait que transmettre. Un refus est affiché tel quel, jamais masqué.
document.querySelector('#home-execute')?.addEventListener('click', async () => {
  const deviceId = document.querySelector('#home-target')?.value?.trim();
  const command = document.querySelector('#home-command')?.value?.trim();
  if (!deviceId || !command) {
    log('Maison : indiquez l’appareil ET la commande.');
    return;
  }
  try {
    const receipt = await api.executeHomeCommand({ deviceId, command });
    log(`Maison : ${command} sur ${deviceId} — ${receipt?.status ?? 'transmis'}.`);
    await refreshHome().catch(() => {});
  } catch (error) {
    log(`Maison : ${error.message}`);
  }
});
document.querySelector('#home-discover')?.addEventListener('click', async () => {
  try {
    // « Détecter » lance la découverte sur CHAQUE connecteur configuré : le handler IPC exige un
    // connectorId précis (contrat exact), il n'existe pas de découverte « tous connecteurs » côté
    // controller. On lit donc les connecteurs connus via connectorHealth, puis on découvre chacun.
    // Aucun connecteur = état HONNÊTE affiché tel quel, jamais un TypeError (home_ui_request_invalid).
    const health = await api.homeConnectorHealth();
    const connectorIds = Object.keys(health ?? {});
    if (connectorIds.length === 0) {
      renderUnavailable('#home-devices', 'Aucun connecteur maison configuré — rien à détecter.');
      return;
    }
    await Promise.all(connectorIds.map((connectorId) => api.discoverHomeDevices({ connectorId })));
    await refreshHome();
  } catch (error) {
    renderUnavailable('#home-devices', String(error?.message ?? error).slice(0, 160));
  }
});

const refreshPersonality = async () => {
  const profile = await api.personalityGet();
  renderList('#personality-profile', [
    ['Nom', profile?.displayName],
    ['Ton', profile?.tone],
    ['Langue', profile?.language],
    ['Version', profile?.version],
  ], personalityRow, { empty: 'Personnalité non configurée.' });
};

// Ces deux champs sont purement DOM (aucun IPC) et alimentent `refreshAnalytics` : posés une fois,
// avant tout, indépendamment du cycle de boot.
elements.analyticsFrom.value = localDateTimeValue(new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000));
elements.analyticsTo.value = localDateTimeValue(new Date());

// Bootstrap du tableau de bord (T1.1 fenêtre-d'abord). Chaque chargement est `.catch`-gardé : si un
// handler IPC n'est pas encore enregistré (la fenêtre s'ouvre AVANT l'init des domaines), l'appel
// échoue proprement en état vide, sans casser le reste. La fonction est rejouée à la réception de
// `mina:boot:ready` (émis quand l'init est terminée), où les données réelles arrivent enfin.
const bootstrapDashboard = () => {
  refreshStartup().catch((error) => log(`Démarrage Windows : ${error.message}`));
  refreshCapabilities().catch((error) => log(`Capacités : ${error.message}`));
  refreshChatChannel().catch((error) => log(`Canal téléphone : ${error.message}`));
  refreshMail().catch(failed('#mail-accounts'));
  refreshPersonal().catch(() => {});
  refreshPrinting().catch(failed('#printing-list'));
  refreshHome().catch(failed('#home-devices'));
  refreshPersonality().catch(failed('#personality-profile'));
  refreshMemoryStatus().catch((error) => log(`Mémoire : ${error.message}`));
  refreshSettings().catch((error) => log(`Paramètres : ${error.message}`));
  profileSettings.refresh().catch((error) => log(`Profil : ${error.message}`));
  // G7 — accueil au premier lancement (ou nouveau profil) : applique le thème du profil et
  // personnalise Mina. `welcome.boot()` ne montre RIEN si `readProfiles` rejette (voir son corps),
  // donc pas d'overlay fantôme au premier paint ; la décision fiable arrive au re-bootstrap.
  welcome.boot()
    .then(() => profileSettings.refresh())
    .catch((error) => log(`Bienvenue : ${error.message}`));
  refreshAnalytics().catch((error) => log(`Analyses : ${error.message}`));
  refreshSkillsSandbox().catch((error) => log(`Skills/Sandbox : ${error.message}`));
  refreshTechnicalLog().catch((error) => log(`Journal technique : ${error.message}`));
};
bootstrapDashboard();
