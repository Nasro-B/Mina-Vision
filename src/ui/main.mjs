import path from 'node:path';
import { createHash, createPublicKey, hkdfSync, randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { access, appendFile, mkdir, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { app, BrowserWindow, dialog, globalShortcut, ipcMain, safeStorage, screen, session } from 'electron';
import { loadConfig, redactConfig } from '../config.mjs';
import { createMinaOrchestrator } from '../core/orchestrator.mjs';
import { createMinaRuntime } from '../core/mina-runtime.mjs';
import { createCapabilityBroker } from '../safety/capability-broker.mjs';
import { createComputerActionAuthorizer } from '../safety/computer-action-authorizer.mjs';
import { createLocalPathPermissions } from '../security/local-path-permissions.mjs';
import { createStartupManager } from '../system/startup-manager.mjs';
import { resolveStorageRoots } from '../system/storage-roots.mjs';
import { createClaimLedger } from '../grounding/claim-ledger.mjs';
import { createSessionManager } from '../sessions/session-manager.mjs';
import { createSessionStore } from '../sessions/session-store.mjs';
import { createKeyring } from '../crypto/keyring.mjs';
import { createKeyringFileStorage } from '../crypto/keyring-file-storage.mjs';
import { createMemoryServices } from '../memory/composition.mjs';
import { createMemoryRuntimeController } from '../memory/runtime-controller.mjs';
import { openMemoryDatabase } from '../memory/database.mjs';
import BetterSqlite3 from 'better-sqlite3';
import { createConfigService, NON_SENSITIVE_CONFIG_KEYS } from '../config/config-service.mjs';
import { createEnvDocumentStore } from '../config/env-document.mjs';
import { createProviderSecretStore } from '../security/provider-secret-store.mjs';
import { loadMinaInstructions } from '../instructions/mina-instructions.mjs';
import { createSkillRegistry } from '../skills/skill-registry.mjs';
import { createSkillInstaller } from '../skills/skill-installer.mjs';
import { createSkillLoader } from '../skills/skill-loader.mjs';
import { createSkillRouter } from '../skills/skill-router.mjs';
import { createSkillSessionManager } from '../skills/skill-session.mjs';
import { createCompositeSkillRuntime } from '../skills/composite-runtime.mjs';
import { createWindowsSandboxBackend } from '../sandbox/windows-sandbox.mjs';
import { createSandboxUiManager } from '../sandbox/sandbox-ui-manager.mjs';
import { createRuntimeManifest } from '../sandbox/runtime-manifest.mjs';
import { createWindowsSandboxLauncher } from '../sandbox/windows-sandbox-launcher.mjs';
import { createJobWorkspaceManager } from '../sandbox/job-workspace.mjs';
import { createSandboxRunner } from '../sandbox/sandbox-runner.mjs';
import { createCodeServices } from '../code/code-services.mjs';
import { createDocumentGenerator } from '../documents/document-generator.mjs';
import { analyzeEntries } from '../diagnostics/error-analyst.mjs';
import {
  createPauseGate,
  createSpeechGate,
  detectPauseCommand,
  detectResumeCommand,
  detectStopCommand,
} from '../voice/speech-stop.mjs';
import { registerCodeIpc } from './code/code-ipc.mjs';
import { createBrowserExecutor } from '../executors/browser-executor.mjs';
import { createBrowserProfileAuthenticator } from '../executors/browser-profile-auth.mjs';
import { createDesktopClient } from '../executors/desktop-client.mjs';
import { createDesktopCursorOverlay } from './desktop-cursor-overlay.mjs';
import { createAdbWifiEndpointStore, createAdbWifiKeeper, createPhoneBridge } from '../executors/phone-bridge.mjs';
import { createAdbMdnsPeerKeeper } from '../executors/adb-mdns-peer.mjs';
import { createPhoneMessageSync } from '../devices/phone-message-sync.mjs';
import { createMessageDeliveryLedger } from '../messaging/message-delivery-ledger.mjs';
import { createHttpsmsClient } from '../messaging/httpsms/client.mjs';
import { createHttpsmsProvider } from '../messaging/httpsms/provider.mjs';
import { createHttpsmsWebhookServer } from '../messaging/httpsms/webhook-server.mjs';
import { createSmsRouter } from '../messaging/sms-router.mjs';
import { createSmsSendPolicy } from '../messaging/sms-send-policy.mjs';
import { createJsonRepository } from '../documents/document-repository.mjs';
import { createWindowsPrintSpooler } from '../printing/windows-print-spooler.mjs';
import { createPrinterRegistry } from '../printing/printer-registry.mjs';
import { createPrintService } from '../printing/print-service.mjs';
import { createSharedCameraRuntime } from '../camera/shared-camera-runtime.mjs';
import { createComputerUseRuntime } from '../providers/computer-use-runtime.mjs';
import { createGeminiLiveSession, DEFAULT_SYSTEM_INSTRUCTION, VOICE_READBACK_PREFIX } from '../providers/gemini-live.mjs';
import { createCameraVisionRuntime } from '../providers/camera-vision-runtime.mjs';
import { createDeepSeekProvider } from '../providers/deepseek.mjs';
import { createFallbackTextGenerator } from '../providers/fallback-text-generator.mjs';
import { createGeminiTextProvider } from '../providers/gemini-text.mjs';
import { createLmStudioProvider } from '../providers/lm-studio.mjs';
import { createLmStudioEmbeddingProvider } from '../providers/lm-studio-embedding.mjs';
import { createOpenAiCompatibleTextProvider } from '../providers/openai-compatible-text.mjs';
import { createTelegramConversationResponder } from '../messaging/telegram-conversation-responder.mjs';
import { createTelegramHomeCommands } from '../messaging/telegram-home-commands.mjs';
import { createTelegramMailCommands } from '../messaging/telegram-mail-commands.mjs';
import { createTelegramCommandRouter } from '../messaging/telegram-command-router.mjs';
import { createUtteranceAggregator } from '../voice/utterance-aggregator.mjs';
import { createGroqWebAnswer, createWebAnswerChain, createWebAnswerService } from '../research/web-answer.mjs';
import { createLocalVoiceClient } from '../voice/local-voice-client.mjs';
import { createDeepgramStt } from '../voice/deepgram-stt.mjs';
import { composeSelfBrief, createSelfModel } from '../core/self-model.mjs';
import { createActivityJournal } from '../diagnostics/activity-journal.mjs';
import { createSensitiveJournalStore } from '../diagnostics/sensitive-journal-store.mjs';
import { composeInstructionState } from '../core/capability-brief.mjs';
import { composeCapabilityCatalog } from '../core/capability-catalog.mjs';
import { composeOperationalBudgets } from '../core/operational-budgets.mjs';
import { createVersionedJsonStore } from '../core/versioned-json-store.mjs';
import { createChatChannel } from '../devices/chat-channel.mjs';
import { createChatResponder } from '../devices/chat-responder.mjs';
import { loadOrCreatePcChatIdentity } from '../devices/pc-chat-identity.mjs';
import {
  createFirestoreRelayAdapter, firebaseConfigFromGoogleServices,
} from '../devices/firestore-relay-adapter.mjs';
import { createRuntimeCapabilityCatalog } from '../runtime/capability-catalog.mjs';
import { registerMinaIpc } from './ipc/register-ipc.mjs';
import { createRoutineRegistry } from '../routines/routine-registry.mjs';
import { createDailyBriefingService } from '../personal/daily-briefing-service.mjs';
import { applyPersonalGraphMigrations, createGraphRepository } from '../graph/graph-repository.mjs';
import { createPersonalGraph } from '../graph/personal-graph.mjs';
import { createEntityResolver } from '../graph/entity-resolver.mjs';
import { createTodayController } from './pages/today-controller.mjs';
import { createGraphController } from './pages/graph-controller.mjs';
import { createDocumentQuarantineStore } from '../documents/document-quarantine.mjs';
import { createDocumentIntake } from '../documents/document-intake.mjs';
import { createDocumentController } from './pages/document-controller.mjs';
import { createPersonalityService } from '../personality/personality-service.mjs';
import { createPersonalityController } from './pages/personality-controller.mjs';
import {
  createDentalVision,
  createGeminiDentalProvider,
  createModalDentalProvider,
  createOpenRouterDentalProvider,
} from '../providers/dental-vision.mjs';
import { createGooglePhotosGrid, runDentalSort } from '../missions/dental-sort.mjs';
import { createVoiceCommandRouter, validateMissionRequest } from './controller.mjs';
import { loadAndShowWindow } from './window-lifecycle.mjs';
import { createSkillsSandboxController } from './pages/skills-sandbox-controller.mjs';
import { registerSkillsSandboxIpc } from './ipc/skills-sandbox-ipc.mjs';
import { createSettingsController } from './pages/settings-controller.mjs';
import { registerSettingsIpc } from './ipc/settings-ipc.mjs';
import { createAnalyticsQuery } from '../usage/analytics-query.mjs';
import { applyUsageMigrations } from '../usage/usage-repository.mjs';
import { createBudgetGuard } from '../usage/budget-guard.mjs';
import { createAnalyticsController } from './pages/analytics-controller.mjs';
import { registerAnalyticsIpc } from './ipc/analytics-ipc.mjs';
import { nativeCacheCandidates } from '../../scripts/native-cache-paths.mjs';
import { createMailAccountStore } from '../mail/mail-account-store.mjs';
import { createMailPolicy } from '../mail/mail-policy.mjs';
import { applyMailMigrations, createMailRepository } from '../mail/mail-repository.mjs';
import { createMailSyncService } from '../mail/mail-sync-service.mjs';
import { createMailService } from '../mail/mail-service.mjs';
import { createMailController } from './pages/mail-controller.mjs';
import { registerMailIpc } from './ipc/mail-ipc.mjs';
import { createSmartHomeRegistry } from '../home/registry.mjs';
import { createSmartHomePolicy } from '../home/policy.mjs';
import { createSmartHomeRouter } from '../home/router.mjs';
import { createSmartHomeService } from '../home/service.mjs';
import { createHomeController } from './pages/home-controller.mjs';
import { registerHomeIpc } from './ipc/home-ipc.mjs';
import { createFaceProfileStore } from '../biometrics/face-profile-store.mjs';
import { createFaceRecognizer } from '../biometrics/face-recognizer.mjs';
import { createCameraController } from './pages/camera-controller.mjs';
import { registerCameraIpc } from './ipc/camera-ipc.mjs';
import { createTechnicalLog, createTechnicalLogReader } from '../diagnostics/technical-log.mjs';
import { createErrorAggregator } from '../diagnostics/error-aggregator.mjs';
import { probeLmStudio } from '../diagnostics/lm-studio-health.mjs';
import { createGoogleRuntimeAdapters } from '../mail/google-runtime-adapters.mjs';
import { loadGoogleClientConfigFromEnvDir } from '../mail/oauth/google-client-config-file.mjs';
import { createPersonalDataHub } from '../personal/personal-data-hub.mjs';
import { createTaskRepository } from '../personal/task-repository.mjs';
import { createTaskService } from '../personal/task-service.mjs';
import { applyPersonalCalendarMigrations, createCalendarRepository } from '../personal/calendar-repository.mjs';
import { createCalendarService } from '../personal/calendar-service.mjs';
import { createContactRepository } from '../personal/contact-repository.mjs';
import { createContactService } from '../personal/contact-service.mjs';
import { createHostWritePolicy } from '../files/host-write-policy.mjs';
import { createMinaFileWorkspace } from '../files/mina-file-workspace.mjs';
import { createYouTubeDataClient } from '../media/youtube-data-client.mjs';

const UI_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(UI_DIR, '../..');
const GOOGLE_PHOTOS_DENTAL_SEARCH = 'https://photos.google.com/u/0/search/CgxkZW50ICsgZGVudHMiDgoMZGVudCArIGRlbnRzKLK4mPC1MzgD';
const SMOKE_MODE = process.argv.includes('--mina-smoke');

dotenv.config({ path: path.join(ROOT_DIR, '.env'), quiet: true });

// userData NOMMÉ : sans productName, Electron rangeait tout dans le dossier générique
// %APPDATA%\Electron, partagé par n'importe quelle app dev sans nom. Renommé PENDANT que le
// coffre mémoire n'existe pas encore (vérifié : seuls des caches Chromium + les préférences UI
// y vivaient) — après création du coffre, cette migration aurait été périlleuse.
app.setName('Mina Vision');
{
  const legacyUserData = path.join(app.getPath('appData'), 'Electron');
  const namedUserData = path.join(app.getPath('appData'), 'Mina Vision');
  if (!existsSync(namedUserData) && existsSync(legacyUserData)) {
    for (const entry of ['Local Storage', 'Session Storage']) {
      try {
        cpSync(path.join(legacyUserData, entry), path.join(namedUserData, entry), { recursive: true });
      } catch { /* préférences UI perdues = valeurs par défaut, jamais bloquant */ }
    }
  }
  app.setPath('userData', namedUserData);
}

let mainWindow = null;
let helpWindow = null;
let runtime = null;
let phoneBridge = null;
let adbWifiKeeper = null;
let samsungAdbWifiKeeper = null;
let phoneMessageSync = null;
let messageDeliveryLedger = null;
let smsRouter = null;
let smsSendPolicy = null;
let httpsmsWebhookServer = null;
// Set once at bootstrap: the Electron-ABI (148) better-sqlite3 binding path. Every SQLite store
// opened outside openMemoryDatabase MUST use it, or better-sqlite3 loads its default Node-ABI (127)
// binding and Electron crashes at boot with NODE_MODULE_VERSION mismatch.
let sqliteNativeBinding = null;

// The confirm/auto/draft_only decision layer for a FUTURE automatic-SMS-reply flow — see
// src/messaging/sms-send-policy.mjs. Not yet consumed anywhere: today no code path generates an
// automatic SMS reply (only Telegram does, in phone-message-sync.mjs), so this policy currently
// has nothing to decide. It is wired now, tested, and ready — including the global kill switch —
// for whenever that generation flow is built (out of this task's file scope).
const getSmsSendPolicy = () => {
  if (smsSendPolicy) return smsSendPolicy;
  const { policy } = currentConfig().sms;
  smsSendPolicy = createSmsSendPolicy({
    mode: policy.sendMode, allowlist: policy.allowlist,
    quietHoursStart: policy.quietHoursStart, quietHoursEnd: policy.quietHoursEnd,
    maxPerMinute: policy.maxPerMinute, maxPerDay: policy.maxPerDay,
  });
  return smsSendPolicy;
};
let phoneMessageSyncTimer = null;
let telegramTextGeneratorInstance = null;
let cameraRuntime = null;
let cameraVision = null;
let voice = null;
let activeOrchestrator = null;
let minaCore = null;
let memoryController = null;
// Set at bootstrap: lets the voice layer and the renderer read Mina's REAL capabilities (installed
// skills, sandbox availability) instead of a hardcoded list.
let capabilityProbes = null;
let settingsController = null;
let providerSecretStore = null;
let analyticsController = null;
let usageDatabase = null;
let skillsSandboxController = null;
let skillRouter = null;
let skillSessions = null;
let sandboxManager = null;
let browserExecutor = null;
let desktopCursorOverlay = null;
let shutdownStarted = false;
let mailController = null;
// Démarrage automatique Windows : construit une seule fois, sans état propre (Windows EST la
// source de vérité — on ne cache jamais un réglage système côté app).
// Racines de stockage portables : par défaut tout vit sous userData (l'app démarre sur
// n'importe quelle machine) ; MINA_CACHE_ROOT/MINA_MODELS_ROOT/MINA_SANDBOX_ROOT permettent de
// déporter les gros caches sur un autre disque. Propagé aux workers par l'environnement.
const storageRoots = resolveStorageRoots({ userDataPath: app.getPath('userData') });
process.env.MINA_MODELS_ROOT ??= storageRoots.modelsRoot;
const startupManager = createStartupManager({
  getLoginItemSettings: (options) => app.getLoginItemSettings(options),
  setLoginItemSettings: (settings) => app.setLoginItemSettings(settings),
  executablePath: process.execPath,
  // En dev (electron .), l'exécutable est electron.exe : sans le dossier du projet, un
  // démarrage automatique lancerait Electron à vide.
  launchArgs: [ROOT_DIR],
  isPackaged: app.isPackaged,
});
// Catalogue de capacités runtime (Task 8) + domaines composés par la réconciliation (T11-T13).
let runtimeCapabilityCatalog = null;
let personalGraphDatabase = null;
let personalControllers = null;
let documentController = null;
let personalityController = null;
let mailDatabase = null;
let mailAccountStoreRef = null;
let mailSyncServiceRef = null;
let mailPolicyRef = null;
let homeController = null;
let homeRegistryRef = null;
let homeServiceRef = null;
let cameraController = null;
let mailOperational = false;
let googleTasksOperational = false;
let googleTaskService = null;
let googleCalendarService = null;
let googleContactService = null;
let personalCalendarDatabase = null;
let mailOperationalAccountIds = [];
let hostWritePolicy = null;
let minaFileWorkspace = null;
let printerRegistry = null;
let printService = null;
let printerRepository = null;

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
app.on('second-instance', () => {
  // A dead window on a live process must never swallow the click: the desktop icon then does
  // NOTHING — the new launch quits on the lock, and the holder had nothing to show (the exact
  // « l'app ne se lance plus depuis le bureau » failure). Recreate instead of returning.
  if (!mainWindow || mainWindow.isDestroyed()) {
    if (app.isReady()) void createWindow().catch(() => {});
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

const sendRaw = (channel, payload) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
};
// Same raw entries feed two views: technicalLog is the append-only recent-history list already
// wired everywhere; errorAggregator collapses the SAME stream by signature so a flaky dependency
// retrying every few seconds shows up as one growing counter instead of drowning the log.
const errorAggregator = createErrorAggregator();
const technicalLog = createTechnicalLog({
  onEntry: (entry) => {
    sendRaw('mina:technical-log', entry);
    if (entry.severity === 'error' || entry.severity === 'warning') {
      sendRaw('mina:technical-log-aggregate', errorAggregator.record(entry));
    }
  },
});
const technicalLogReader = createTechnicalLogReader({ technicalLog });
let selfModel = null;
let activityJournal = null;
// Canal `mina_app` : la clé maîtresse n'est PAS conservée ailleurs — cette référence suit
// exactement l'état du coffre, donc verrouiller la mémoire coupe aussi le canal téléphone.
let chatChannel = null;
let chatMasterKey = null;
// Couche 2 du journal (Task 5) : textes chiffrés, armée au déverrouillage du coffre.
let sensitiveJournalStore = null;
// Porte du mot d'arrêt vocal : après « stop », les chunks audio restants du tour interrompu
// sont jetés jusqu'à la fin de tour (sinon Mina reprend sa phrase coupée depuis le buffer).
const speechGate = createSpeechGate();
// Mode PAUSE : silence TOTAL garanti par le code — plus d'audio, plus d'outils, plus de routage,
// voix ambiantes ignorées — jusqu'à ce que le NOM soit prononcé (« Mina », « reprends Mina »).
const pauseGate = createPauseGate();
// Mots de contrôle vocaux (pause / reprise / stop) — passage OBLIGATOIRE avant tout routage.
// Retourne true si l'énoncé est consommé (silence de pause ou transition d'état).
const handleVoiceControlWords = (utterance) => {
  if (pauseGate.isPaused()) {
    if (detectResumeCommand(utterance)) {
      pauseGate.resume();
      send('mina:event', { type: 'voice_resumed' });
      void getLocalVoice().speak('Je suis là, mon créateur.').catch(() => {});
    }
    // En pause, TOUT énoncé est consommé : aucune commande, aucun dialogue, aucune mémoire.
    return true;
  }
  if (detectPauseCommand(utterance)) {
    pauseGate.pause();
    speechGate.noteStop();
    sendRaw('mina:voice-stop-speech');
    send('mina:event', { type: 'voice_paused' });
    void getLocalVoice().speak('En pause.').catch(() => {});
    return true;
  }
  if (detectStopCommand(utterance)) {
    speechGate.noteStop();
    sendRaw('mina:voice-stop-speech');
    void activityJournal?.append('voice_stop_command', { utterance: String(utterance).slice(0, 60) });
  }
  return false;
};
// Services Mina Code (indexeur, recherche, git lecture, tests, revue) — un seul exemplaire
// paresseux pour l'IPC et la voix.
let codeServicesInstance = null;
const getCodeServices = () => {
  codeServicesInstance ??= createCodeServices({
    projectRoot: app.getAppPath(),
    plansDirectory: path.join(app.getPath('userData'), 'code-plans'),
    activityJournal,
  });
  return codeServicesInstance;
};
// Générateur de documents (PDF/DOCX) — sortie dans Documents/Mina Vision de Nasro, noms
// horodatés, jamais d'écrasement. Paresseux : construit au premier « génère-moi un document ».
let documentGeneratorInstance = null;
const getDocumentGenerator = () => {
  documentGeneratorInstance ??= createDocumentGenerator({
    outputDirectory: path.join(app.getPath('documents'), 'Mina Vision'),
    fs: { writeFile, mkdir, access },
  });
  return documentGeneratorInstance;
};
// Énoncés finaux et intentions — le transcript fragmenté et l'audio binaire restent hors journal.
const JOURNALED_CHANNELS = new Set(['mina:voice-wake', 'mina:voice-command', 'mina:voice-dialogue', 'mina:voice-intent']);
const send = (channel, payload) => {
  if (channel === 'mina:event') {
    technicalLog.recordEvent(payload);
    // Self-model DÉRIVÉ : il n'observe que des événements réels (missions, dégradations) — jamais
    // du texte libre. C'est la porte unique qui le garde honnête.
    selfModel?.observeEvent(payload);
    // TOUT événement runtime part au journal persistant — c'est la source que Mina relit.
    void activityJournal?.append(payload?.type ?? 'event', payload);
  } else if (JOURNALED_CHANNELS.has(channel)) {
    void activityJournal?.append(channel.replace('mina:', ''), { payload });
  }
  sendRaw(channel, payload);
};

// Garde-fous de dernier recours : un crash non rattrapé est CONSIGNÉ (journal technique +
// journal persistant) au lieu de tuer le process en silence — l'app est fail-soft partout,
// survivre en le disant vaut mieux que mourir muette.
process.on('uncaughtException', (error) => {
  technicalLog.record({
    severity: 'error', scope: 'process', code: 'uncaught_exception',
    message: String(error?.stack ?? error).slice(0, 300),
  });
  void activityJournal?.append('crash', { code: 'uncaught_exception', message: String(error?.message ?? error).slice(0, 200) });
});
process.on('unhandledRejection', (reason) => {
  technicalLog.record({
    severity: 'error', scope: 'process', code: 'unhandled_rejection',
    message: String(reason?.stack ?? reason).slice(0, 300),
  });
  void activityJournal?.append('crash', { code: 'unhandled_rejection', message: String(reason?.message ?? reason).slice(0, 200) });
});

const currentConfig = () => loadConfig(process.env);

// Natural local fallback voice (Kokoro, worker process). Lazy: the model loads at the first
// spoken fallback, never at boot. Chunks reuse the exact Gemini audio channel and format.
let localVoiceInstance = null;
const getLocalVoice = () => {
  localVoiceInstance ??= createLocalVoiceClient({
    onAudioChunk: (chunk) => send('mina:voice-audio', { audio: chunk.audio, mimeType: 'audio/pcm;rate=24000' }),
    onDiagnostic: workerDiagnostic('worker:kokoro'),
  });
  return localVoiceInstance;
};

// Lazy: created at the first « trouve-moi un article » so a missing key surfaces as the typed
// web_answer_unconfigured error at call time, never as a boot failure. Gemini first (proper
// grounded citations), Groq compound as rescue — its free quota survives when Gemini's is spent
// by the live voice session.
let webAnswerServiceInstance = null;
const getWebAnswerService = () => {
  if (!webAnswerServiceInstance) {
    const config = currentConfig();
    webAnswerServiceInstance = createWebAnswerChain({
      providers: [
        config.geminiApiKey ? createWebAnswerService({ apiKey: config.geminiApiKey }) : null,
        config.groqApiKey ? createGroqWebAnswer({ apiKey: config.groqApiKey }) : null,
      ],
    });
  }
  return webAnswerServiceInstance;
};

const providerSecret = async (providerId, fallback, field = 'apiKey') => {
  if (fallback) return fallback;
  try {
    if (!providerSecretStore || !await providerSecretStore.has(providerId)) return null;
    return (await providerSecretStore.getForProvider(providerId))[field] ?? null;
  } catch {
    return null;
  }
};

const openAiBaseUrl = (value) => {
  const root = String(value ?? '').replace(/\/+$/u, '');
  return root.endsWith('/v1') ? root : `${root}/v1`;
};

const telegramTextGenerator = async () => {
  if (telegramTextGeneratorInstance) return telegramTextGeneratorInstance;
  const config = currentConfig();
  const providers = [];
  const geminiKey = await providerSecret('gemini', config.geminiApiKey);
  if (geminiKey) providers.push(createGeminiTextProvider({
    apiKey: geminiKey, model: config.providers.gemini.model,
  }));
  const deepseekKey = await providerSecret('deepseek', config.deepseekApiKey);
  if (deepseekKey) providers.push(createDeepSeekProvider({
    apiKeyProvider: async () => deepseekKey,
    baseURL: config.providers.deepseek.baseUrl,
    model: config.providers.deepseek.model,
  }));
  const openrouterKey = await providerSecret('openrouter', config.openrouterApiKey);
  if (openrouterKey) providers.push(createOpenAiCompatibleTextProvider({
    id: 'openrouter', apiKey: openrouterKey,
    baseURL: config.providers.openrouter.baseUrl,
    model: config.providers.openrouter.model ?? 'openrouter/free',
  }));
  if (config.modalEndpoint && config.modalTokenId && config.modalTokenSecret) {
    providers.push(createOpenAiCompatibleTextProvider({
      id: 'modal', apiKey: 'unused', baseURL: openAiBaseUrl(config.modalEndpoint),
      model: config.providers.modal.model ?? 'Qwen/Qwen3.5-9B',
      defaultHeaders: { 'Modal-Key': config.modalTokenId, 'Modal-Secret': config.modalTokenSecret },
    }));
  }
  const huggingFaceToken = await providerSecret('huggingface', null, 'token');
  if (huggingFaceToken && config.providers.huggingface.model) {
    providers.push(createOpenAiCompatibleTextProvider({
      id: 'huggingface', apiKey: huggingFaceToken,
      baseURL: openAiBaseUrl(config.providers.huggingface.baseUrl),
      model: config.providers.huggingface.model,
    }));
  }
  if (config.providers.lmStudio.enabled && config.providers.lmStudio.model) {
    providers.push(createLmStudioProvider({
      baseURL: config.providers.lmStudio.baseUrl,
      model: config.providers.lmStudio.model,
      timeoutMs: config.providers.lmStudio.timeoutMs,
    }));
  }
  telegramTextGeneratorInstance = createFallbackTextGenerator({
    providers,
    mode: config.inference.mode,
    offline: config.inference.offline,
    onFailure: ({ providerId, error }) => technicalLog.record({
      severity: 'warning', scope: 'telegram:provider', code: `telegram_${providerId}_failed`,
      message: String(error?.message ?? error).slice(0, 500),
    }),
  });
  return telegramTextGeneratorInstance;
};

const requireRotatedCredentials = () => {
  const config = currentConfig();
  if (!config.credentialsRotated) {
    throw new Error('Clés API verrouillées : renouvelez Gemini/OpenRouter/Modal puis définissez MINA_KEYS_ROTATED=true.');
  }
  return config;
};

// Jointure des deux couches du journal (Task 5) : la couche 1 donne les faits épurés
// (charCount + digest), la couche 2 restitue le texte exact SI le coffre est déverrouillé.
// Coffre verrouillé → les métadonnées sortent quand même, avec l'état dit honnêtement —
// la « règle de vérité sur le passé » ne devine jamais.
const readJournalWithSensitiveText = async ({ limit, kinds } = {}) => {
  const entries = await (activityJournal?.read({ limit, kinds }) ?? Promise.resolve([]));
  const digests = entries
    .map((entry) => entry?.payload?.digest)
    .filter((digest) => typeof digest === 'string' && digest.startsWith('sha256:'));
  if (!digests.length || !sensitiveJournalStore) return entries;
  if (!sensitiveJournalStore.isUnlocked()) {
    return entries.map((entry) => (entry?.payload?.digest
      ? Object.freeze({ ...entry, payload: { ...entry.payload, texte: '[coffre verrouillé — texte disponible après déverrouillage]' } })
      : entry));
  }
  const texts = await sensitiveJournalStore.read({ digests }).catch(() => new Map());
  return entries.map((entry) => {
    const digest = entry?.payload?.digest;
    if (!digest || !texts.has(digest)) return entry;
    return Object.freeze({ ...entry, payload: { ...entry.payload, texte: texts.get(digest).slice(0, 400) } });
  });
};

const confirmSensitiveAction = async ({ reason, action }) => {
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: 'Autorisation Mina',
    message: reason || 'Action sensible',
    detail: `Action demandée : ${action?.name || 'inconnue'}`,
    buttons: ['Refuser', 'Autoriser une fois'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  return result.response === 1;
};

const getPhoneBridge = () => {
  if (!phoneBridge) {
    const config = currentConfig();
    phoneBridge = createPhoneBridge({ adbPath: config.adbPath, scrcpyPath: config.scrcpyPath });
  }
  return phoneBridge;
};

// Persisted so a Telegram/SMS reply already generated (or already sent) before an app restart is
// never redone, and so an SMS already accepted by one provider is never resent to the other —
// see src/messaging/message-delivery-ledger.mjs for the state machine.
const getMessageDeliveryLedger = () => {
  messageDeliveryLedger ??= createMessageDeliveryLedger({
    filename: path.join(app.getPath('userData'), 'mina-message-delivery.sqlite'), nativeBinding: sqliteNativeBinding,
  });
  return messageDeliveryLedger;
};

// httpSMS is a protocol adapter only (never the AGPL httpsms-main service) — inert with
// configured:false until Nasro provides base URL, API key, webhook secret AND a sender number.
// Until then the native Huawei ADB path behaves exactly as before this wiring.
const getSmsRouter = async () => {
  if (smsRouter) return smsRouter;
  const config = currentConfig();
  const nativeProvider = {
    id: 'native',
    send: async ({ requestId, to, content }) => {
      const receipt = await getPhoneBridge().sendSmsConfirmed({ sourceMessageId: requestId, recipientE164: to, text: content });
      return Object.freeze({ providerId: 'native', accepted: true, providerMessageId: receipt?.id ?? null, state: 'accepted_by_provider' });
    },
  };
  let httpsmsProvider = null;
  if (config.sms.httpsms.enabled) {
    // Secret read from .env first (Nasro keeps everything in .env), then the encrypted keyring —
    // matches the enabled-check above which is itself driven by the .env variables.
    const apiKey = await providerSecret('httpsms', process.env.HTTPSMS_API_KEY, 'apiKey');
    if (apiKey) {
      httpsmsProvider = createHttpsmsProvider({
        client: createHttpsmsClient({ baseUrl: config.sms.httpsms.baseUrl, apiKey }),
      });
    }
  }
  smsRouter = createSmsRouter({
    nativeProvider, httpsmsProvider, mode: config.sms.httpsms.mode, ledger: getMessageDeliveryLedger(),
  });
  return smsRouter;
};

// Owner check shared by every deterministic Telegram command: message.sender is "userId:chatId"
// (see telegramReplyTarget below) — only the configured owner chat id may ever trigger /home or
// /mail. No owner configured (Nasro hasn't set TELEGRAM_OWNER_CHAT_ID yet) means every command is
// honestly refused rather than silently trusted.
const isTelegramOwner = async (sender) => {
  const ownerChatId = currentConfig().telegram.ownerChatId;
  if (!ownerChatId) return false;
  const chatId = String(sender ?? '').split(':').pop();
  return chatId === ownerChatId;
};

const getPhoneMessageSync = () => {
  if (!memoryController) throw new Error('memory_runtime_unavailable');
  const conversation = createTelegramConversationResponder({
    generate: async (input) => (await telegramTextGenerator()).generate(input),
  });
  // Deterministic slash commands are tried BEFORE the conversational LLM ever sees the message —
  // this ordering is the whole security boundary (see telegram-command-router.mjs). Both handlers
  // are optional: a domain that failed to compose (see the try/catch blocks above) simply drops
  // out of the router instead of ever faking availability.
  const homeCommands = (homeServiceRef && homeRegistryRef) ? createTelegramHomeCommands({
    isOwner: isTelegramOwner, homeService: homeServiceRef, homeRegistry: homeRegistryRef,
    audit: (event) => send('mina:event', { type: 'telegram_audit', ...event }),
  }) : null;
  const mailCommands = (mailAccountStoreRef && mailSyncServiceRef && mailPolicyRef) ? createTelegramMailCommands({
    isOwner: isTelegramOwner, mailAccountStore: mailAccountStoreRef, mailSyncService: mailSyncServiceRef,
    mailPolicies: { default: mailPolicyRef }, searchMessages: async () => [],
    audit: (event) => send('mina:event', { type: 'telegram_audit', ...event }),
    notifyPc: async (event) => send('mina:event', { type: 'telegram_audit', ...event }),
  }) : null;
  const commandRouter = createTelegramCommandRouter({ homeCommands, mailCommands, conversation });
  phoneMessageSync ??= createPhoneMessageSync({
    phoneBridge: getPhoneBridge(),
    memoryController,
    // Adapts the router's {reply:[...], source} back to the single-string interface
    // phone-message-sync.mjs's delivery ledger already expects (Task 1) — segments are joined,
    // never sent as separate messages, so idempotent redelivery still sees exactly one reply.
    telegramResponder: { reply: async (message) => (await commandRouter.handle({ sender: message.sender, body: message.body })).reply.join('\n\n') },
    ledger: getMessageDeliveryLedger(),
  });
  return phoneMessageSync;
};

const stopLiveCamera = async () => {
  if (!cameraController) return { stopped: false };
  return cameraController.stop();
};

const startLiveCamera = async () => {
  if (!cameraController) throw new Error('camera_runtime_unavailable');
  const status = await cameraController.status();
  if (status.active) return { started: false, state: 'already_active' };
  const phone = status.devices[0] ?? await getPhoneBridge().detect();
  const result = await cameraController.start({ deviceId: phone.deviceId, lens: 'front' });
  return { ...result, started: true };
};

const analyzeLiveCamera = async (prompt) => {
  if (!cameraRuntime || !cameraController) throw new Error('camera_runtime_unavailable');
  const status = await cameraController.status();
  if (!status.active) await startLiveCamera();
  const frame = cameraRuntime.latestFrame() ?? (await cameraRuntime.frames().next()).value;
  if (!frame?.jpeg) throw new Error('camera_frame_unavailable');
  if (!cameraVision) {
    const cameraVisionRuntime = createCameraVisionRuntime({ config: requireRotatedCredentials() });
    cameraVision = cameraVisionRuntime.cameraVision;
  }
  return cameraVision.analyze({
    image: frame.jpeg,
    mimeType: frame.mimeType,
    prompt: String(prompt ?? 'Décris ce que tu vois devant la caméra.').trim().slice(0, 2_000),
  });
};

const syncPhoneMessages = async () => {
  if (memoryController?.status().locked !== false) throw new Error('memory_locked');
  const result = await getPhoneMessageSync().run();
  if (result.stored > 0) send('mina:event', { type: 'phone_messages_synced', ...result });
  return result;
};

const startPhoneMessageSyncLoop = () => {
  if (phoneMessageSyncTimer) return;
  const tick = () => {
    if (memoryController?.status().locked !== false) return;
    void syncPhoneMessages().catch((error) => technicalLog.record({
      severity: 'error',
      scope: 'telegram:sync',
      code: String(error?.message ?? 'telegram_sync_failed').slice(0, 120),
      message: String(error?.message ?? error).slice(0, 500),
    }));
  };
  phoneMessageSyncTimer = setInterval(tick, 5_000);
  phoneMessageSyncTimer.unref?.();
  tick();
};

// Receiving side of HTTPSMS: a local, loopback-only webhook server that ingests inbound SMS the
// httpSMS app relays. Every request is signature-verified before its body is trusted; a received
// SMS is stored durably exactly like a native SMS (rememberRemoteMessage), so cross-channel recall
// and the delivery ledger treat both paths identically. Started only when HTTPSMS is configured.
const startHttpsmsWebhookServer = async () => {
  if (httpsmsWebhookServer) return { started: true };
  const config = currentConfig();
  if (!config.sms.httpsms.enabled) return { started: false, reason: 'httpsms_not_configured' };
  if (!memoryController) return { started: false, reason: 'memory_runtime_unavailable' };
  const secret = await providerSecret('httpsms-webhook', process.env.HTTPSMS_WEBHOOK_SECRET, 'secret');
  if (!secret) return { started: false, reason: 'httpsms_webhook_secret_missing' };
  const server = createHttpsmsWebhookServer({
    secret,
    port: config.sms.httpsms.webhookPort,
    onInboundMessage: async (message) => {
      const device = await getPhoneBridge().detect().catch(() => ({ deviceId: 'httpsms' }));
      await memoryController.rememberRemoteMessage({
        id: message.id, channel: 'sms', sender: message.sender, body: message.body,
        sentAtMs: message.sentAtMs ?? Date.now(), deviceId: device?.deviceId ?? 'httpsms',
      });
      send('mina:event', { type: 'sms_received', providerId: 'httpsms', sender: message.sender });
    },
  });
  const { port } = await server.start();
  httpsmsWebhookServer = server;
  technicalLog.record({ severity: 'warning', scope: 'httpsms:webhook', code: 'httpsms_webhook_listening', message: `loopback:${port}` });
  return { started: true, port };
};

const confirmDigestAction = async ({ reason, action }) => {
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: 'Validation locale Mina Vision',
    message: reason || 'Action sensible',
    detail: `Action : ${action?.name || 'inconnue'}\nEmpreinte : ${action?.digest || 'absente'}`,
    buttons: ['Refuser', 'Autoriser une fois'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  return Object.freeze({
    approved: result.response === 1,
    digest: action?.digest ?? null,
    token: result.response === 1 ? randomUUID() : null,
  });
};

const getBrowserExecutor = async () => {
  if (browserExecutor?.isClosed?.()) browserExecutor = null;
  if (!browserExecutor) {
    browserExecutor = await createBrowserExecutor({
      profileDir: path.join(app.getPath('userData'), 'mina-chrome-profile'),
    });
  }
  return browserExecutor;
};

// "Ferme le navigateur" / "arrête la musique" (voice): closes only the browser the mission executor
// drives, not the whole app. Nulled out after close so the next mission gets a fresh instance rather
// than reusing a closed Playwright context.
const closeBrowserExecutor = async () => {
  if (activeOrchestrator) await activeOrchestrator.emergencyStop();
  const current = browserExecutor;
  browserExecutor = null;
  if (current) await current.close();
  return { closed: true };
};

const openGoogleBrowserLogin = async () => {
  await closeBrowserExecutor();
  const authenticator = createBrowserProfileAuthenticator({
    profileDir: path.join(app.getPath('userData'), 'mina-chrome-profile'),
  });
  return authenticator.openGoogleSignIn();
};

const getYouTubeDataClient = async () => {
  const config = currentConfig();
  if (config.inference.offline) throw new Error('youtube_api_forbidden_offline');
  const apiKey = await providerSecret('youtube', process.env.YOUTUBE_API_KEY);
  if (!apiKey) throw new Error('youtube_api_key_missing');
  return createYouTubeDataClient({ apiKey });
};

const getRuntime = async () => {
  if (runtime) return runtime;
  const config = requireRotatedCredentials();
  const computerUseRuntime = createComputerUseRuntime({ config });
  desktopCursorOverlay ??= createDesktopCursorOverlay({ BrowserWindow, screen });
  const desktop = createDesktopClient({
    onEvent: (event) => send('mina:event', event),
    onDiagnostic: workerDiagnostic('worker:desktop'),
    previewAction: (action, metadata) => desktopCursorOverlay.previewAction(action, metadata),
    hideCursor: () => desktopCursorOverlay.hide(),
  });

  runtime = {
    config,
    computerUse: computerUseRuntime.computerUse,
    computerUseProviders: computerUseRuntime.providers,
    desktop,
    phone: getPhoneBridge(),
    getBrowser: getBrowserExecutor,
    close: async () => {
      desktop.close();
      desktopCursorOverlay?.close();
      desktopCursorOverlay = null;
      phoneBridge?.stopPreview();
    },
  };
  return runtime;
};

// Arrêt d'urgence TRANSVERSAL (amélioration E) : l'ordre coupe TOUT ce qui parle ou agit —
// caméra, voix Gemini, repli Deepgram, audio déjà envoyé au renderer, mission active (code
// compris via l'orchestrateur), exécuteur desktop, runtime de sessions. Les portes vocales
// sont remises à zéro : après une urgence, Mina n'est ni muette ni en pause fantôme.
const stopEverything = async () => {
  await stopLiveCamera();
  voice?.close();
  voice = null;
  deepgramFallback?.close();
  deepgramFallback = null;
  sendRaw('mina:voice-stop-speech');
  speechGate.noteTurnComplete();
  pauseGate.resume();
  if (activeOrchestrator) await activeOrchestrator.emergencyStop();
  else if (runtime?.desktop) await runtime.desktop.emergencyStop().catch(() => {});
  if (minaCore) await minaCore.emergencyStop();
  void activityJournal?.append('emergency_stop', { transversal: true });
  send('mina:event', { type: 'emergency_stop' });
  return { stopped: true };
};

const startMission = async (request) => {
  const mission = validateMissionRequest(request);
  if (!minaCore) throw new Error('Runtime Mina indisponible.');
  if (!hostWritePolicy) throw new Error('host_write_policy_unavailable');
  if (!minaFileWorkspace) throw new Error('mina_file_workspace_unavailable');
  const preparedMission = await minaFileWorkspace.prepareMission(mission);
  const prepared = preparedMission.mission;
  if (hostWritePolicy.requiresMissionConfirmation(prepared)) {
    const approved = await confirmSensitiveAction({
      reason: `Cette mission peut écrire hors des dossiers Mina Vision : ${prepared.goal}`,
      action: { name: 'files.write', environment: prepared.environment },
    });
    if (!approved) throw new Error('host_write_confirmation_refused');
  }
  const activeRuntime = await getRuntime();
  const executor = prepared.environment === 'browser'
    ? await activeRuntime.getBrowser()
    : prepared.environment === 'mobile'
      ? activeRuntime.phone
      : activeRuntime.desktop;

  return minaCore.runWork({
    channel: 'local',
    identityId: 'owner',
    goal: prepared.goal,
    memoryRequired: prepared.memoryRequired === true,
    run: async ({ evidence, workSessionId }) => {
      // R-01 : le broker devient l'autorité de CHAQUE action Computer Use. Le grant est borné
      // à cette mission (workSessionId) et à sa durée — jamais computer.* sans borne
      // temporelle. Les actions sensibles exigent en plus la confirmation one-shot digest-bound.
      const missionBroker = createCapabilityBroker({
        grants: [{
          sessionId: workSessionId ?? 'local-mission',
          capabilities: ['computer.*'],
          effects: ['read', 'execute'],
          resources: ['*'],
          expiresAt: new Date(Date.now() + activeRuntime.config.missionTimeoutMs + 60_000).toISOString(),
        }],
      });
      const orchestrator = createMinaOrchestrator({
        computerUse: activeRuntime.computerUse,
        executors: { [prepared.environment]: executor },
        confirm: confirmSensitiveAction,
        onEvent: (event) => send('mina:event', event),
        actionAuthorizer: createComputerActionAuthorizer({ capabilityBroker: missionBroker }),
      });
      activeOrchestrator = orchestrator;
      try {
        const result = await orchestrator.run({
          ...prepared,
          evidence,
          workSessionId: workSessionId ?? 'local-mission',
          mode: activeRuntime.config.inference.mode,
          offline: activeRuntime.config.inference.offline,
          maxActions: activeRuntime.config.maxActions,
          timeoutMs: activeRuntime.config.missionTimeoutMs,
        });
        try {
          return await minaFileWorkspace.verifyMission(result, preparedMission);
        } catch (error) {
          send('mina:event', { type: 'action_error', action: { name: 'files.write' }, error: error.message });
          throw error;
        }
      } finally {
        if (activeOrchestrator === orchestrator) activeOrchestrator = null;
      }
    },
  });
};

const runDentalMission = async ({ maxItems = 100 } = {}) => {
  const activeRuntime = await getRuntime();
  const browser = await activeRuntime.getBrowser();
  const providers = [createGeminiDentalProvider({ apiKey: activeRuntime.config.geminiApiKey })];

  if (activeRuntime.config.openrouterApiKey && activeRuntime.config.openrouterVisionModel) {
    providers.push(createOpenRouterDentalProvider({
      apiKey: activeRuntime.config.openrouterApiKey,
      model: activeRuntime.config.openrouterVisionModel,
    }));
  }
  if (activeRuntime.config.modalEndpoint) {
    providers.push(createModalDentalProvider({
      endpoint: activeRuntime.config.modalEndpoint,
      tokenId: activeRuntime.config.modalTokenId,
      tokenSecret: activeRuntime.config.modalTokenSecret,
    }));
  }

  const vision = createDentalVision({
    gemini: providers[0],
    openrouter: providers[1],
    modal: providers[2],
  });
  const grid = createGooglePhotosGrid(browser.getPage());
  return runDentalSort({
    grid,
    vision,
    searchUrl: GOOGLE_PHOTOS_DENTAL_SEARCH,
    maxItems: Math.min(Math.max(Number(maxItems) || 100, 1), 500),
    dryRun: activeRuntime.config.dryRun,
    confirm: ({ count }) => confirmSensitiveAction({
      reason: `Télécharger ${count} photo(s) sélectionnée(s) ?`,
      action: { name: 'download' },
    }),
    onProgress: (progress) => send('mina:event', {
      type: 'dental_progress',
      analyzed: progress.analyzed,
      selected: progress.selected,
      rejected: progress.rejected,
      errors: progress.errors,
    }),
  });
};

// Real state, probed at call time — the source of truth for "que sais-tu faire ?" and for the
// state block injected into the live instruction. Every probe fails soft to an honest negative.
// « Elle n'arrive plus à dire ses compétences » (2026-07-22) : les sondes sandbox (PowerShell,
// jusqu'à 10 s chacune) et téléphone (adb) rendaient parfois la réponse si tardive que le tour
// vocal était déjà passé. Plafond de 3 s : au-delà, on répond avec le DERNIER instantané connu
// (honnête — l'état change lentement) pendant que la sonde continue en fond et met à jour le cache.
let capabilitySnapshotCache = null;
const capabilitySnapshot = async () => {
  const fresh = capabilitySnapshotFresh().then((snapshot) => {
    capabilitySnapshotCache = snapshot;
    return snapshot;
  });
  const budget = new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 3_000);
    timer.unref?.();
  });
  const winner = await Promise.race([fresh, budget]);
  if (winner) return winner;
  void fresh.catch(() => {});
  return capabilitySnapshotCache ?? {
    skills: [],
    bundledSkills: [],
    sandbox: { available: false, reason: 'probe_lente' },
    phone: { connected: false },
    memoryUnlocked: memoryController ? memoryController.status()?.locked === false : false,
    voice: Boolean(voice),
    mail: { implemented: true },
    googleTasks: { implemented: true },
    googleCalendar: { implemented: true },
    googleContacts: { implemented: true },
  };
};
const capabilitySnapshotFresh = async () => {
  const [skills, bundledSkills, sandbox, phone, mailAccounts] = await Promise.all([
    capabilityProbes?.listSkills().catch(() => []) ?? [],
    capabilityProbes?.listBundledSkills().catch(() => []) ?? [],
    capabilityProbes?.sandboxDetect().catch(() => ({ available: false, reason: 'probe_failed' })) ?? { available: false, reason: 'probe_failed' },
    getPhoneBridge().detect().then((device) => ({ connected: true, model: device.model || 'Android' })).catch(() => ({ connected: false })),
    mailController?.listAccounts?.().catch(() => []) ?? [],
  ]);
  const googleConfigured = mailAccounts.some((account) => ['google', 'gmail'].includes(String(account.provider).toLowerCase()));
  return {
    skills,
    bundledSkills,
    sandbox,
    phone,
    memoryUnlocked: memoryController ? memoryController.status()?.locked === false : false,
    voice: Boolean(voice),
    mail: { implemented: true, configured: mailAccounts.length > 0, operational: mailOperational },
    googleTasks: { implemented: true, configured: googleConfigured, operational: googleTasksOperational },
    googleCalendar: { implemented: true, configured: googleConfigured, operational: Boolean(googleCalendarService) },
    googleContacts: { implemented: true, configured: googleConfigured, operational: Boolean(googleContactService) },
  };
};

const operationDigest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

const createGoogleTaskFromVoice = async ({ titre, echeance = null } = {}) => {
  if (!googleTaskService) throw new Error('google_tasks_runtime_unavailable');
  if (typeof titre !== 'string' || titre.trim().length < 1 || titre.length > 500) throw new TypeError('google_task_title_invalid');
  const payload = { title: titre.trim(), dueAt: echeance || null };
  const confirmation = await confirmDigestAction({
    reason: `Créer la tâche Google « ${payload.title} » ?`,
    action: { name: 'google.tasks.create', digest: operationDigest(payload) },
  });
  if (!confirmation.approved) throw new Error('google_task_confirmation_refused');
  const proposed = await googleTaskService.propose({ ...payload, sourceRef: 'voice:local', providerId: 'google' });
  const activated = await googleTaskService.activate(proposed.taskId);
  return Object.freeze({ state: 'created', taskId: activated.providerTaskId, title: activated.title, dueAt: activated.dueAt });
};

const createCalendarEventFromVoice = async ({ titre, debut, fin, lieu = null } = {}) => {
  if (!googleCalendarService) throw new Error('google_calendar_runtime_unavailable');
  if (typeof titre !== 'string' || titre.trim().length < 1 || titre.length > 500) throw new TypeError('google_event_title_invalid');
  const startAt = new Date(debut).toISOString();
  const endAt = new Date(fin).toISOString();
  const payload = { title: titre.trim(), startAt, endAt, location: lieu || undefined, providerId: 'google' };
  // calendar-service.commitProposal() asks its own confirmationService (wired to confirmSensitiveAction
  // above) — proposeCreate itself never mutates anything, so no separate confirmDigestAction gate here.
  const proposal = await googleCalendarService.proposeCreate(payload);
  const created = await googleCalendarService.commitProposal(proposal.proposalId);
  return Object.freeze({ state: 'created', eventId: created.eventId, title: created.title, startAt: created.startAt, endAt: created.endAt });
};

// Read-only: looks up an already-synced contact by name in the local mirror. Never queries Google
// live (People API sync is a separate, explicit operation) and never guesses an unlisted contact.
const lookupContactFromVoice = async ({ nom } = {}) => {
  if (!googleContactService) throw new Error('google_contacts_runtime_unavailable');
  if (typeof nom !== 'string' || nom.trim().length < 1) throw new TypeError('contact_lookup_name_invalid');
  const needle = nom.trim().toLocaleLowerCase('fr-FR');
  const people = await googleContactService.list?.();
  const matches = (Array.isArray(people) ? people : [])
    .filter((person) => !person.tombstoned && String(person.displayName ?? '').toLocaleLowerCase('fr-FR').includes(needle));
  if (matches.length === 0) return Object.freeze({ state: 'not_found', query: nom });
  const person = matches[0];
  return Object.freeze({
    state: 'found', displayName: person.displayName,
    endpoints: person.endpoints.map((endpoint) => `${endpoint.channel}:${endpoint.value}`),
    multipleMatches: matches.length > 1,
  });
};

const sendEmailFromVoice = async ({ destinataire, sujet, message } = {}) => {
  if (!mailController || mailOperationalAccountIds.length !== 1) throw new Error('mail_runtime_account_unavailable');
  if (typeof destinataire !== 'string' || !destinataire.includes('@') || typeof sujet !== 'string'
    || typeof message !== 'string' || message.length < 1 || message.length > 100_000) throw new TypeError('mail_voice_request_invalid');
  const payload = { to: [destinataire.trim()], subject: sujet.slice(0, 500), text: message };
  const confirmation = await confirmDigestAction({
    reason: `Envoyer cet e-mail à ${payload.to[0]} ?`,
    action: { name: 'mail.send', digest: operationDigest(payload) },
  });
  if (!confirmation.approved) throw new Error('mail_confirmation_refused');
  const proposal = await mailController.proposeSend({
    accountId: mailOperationalAccountIds[0], targets: { to: payload.to },
    content: { subject: payload.subject, text: payload.text }, revision: `voice:${Date.now()}`,
    confirmedLocally: true,
  });
  return mailController.commit(proposal.proposalId);
};

// Live function declarations: Gemini understands ANY phrasing (evolving vocabulary, no keyword
// list to maintain) and emits a structured intent in the same conversational turn. The renderer
// executes intents through the SAME deterministic paths as the text layer, with dedup against it.
const LIVE_TOOLS = [{
  functionDeclarations: [
    {
      name: 'lancer_mission',
      description: "Lance une mission réelle quand le créateur demande d'agir sur le web, le PC ou le téléphone, quelle que soit la formulation.",
      parameters: {
        type: 'OBJECT',
        properties: {
          objectif: { type: 'STRING', description: 'La demande complète du créateur, claire et autonome.' },
          environnement: { type: 'STRING', enum: ['browser', 'desktop', 'mobile'] },
        },
        required: ['objectif'],
      },
    },
    {
      name: 'selectionner_environnement',
      description: "Sélectionne la surface active sans lancer de mission quand le créateur demande seulement de passer au navigateur, au bureau Windows ou au téléphone.",
      parameters: {
        type: 'OBJECT',
        properties: { environnement: { type: 'STRING', enum: ['browser', 'desktop', 'mobile'] } },
        required: ['environnement'],
      },
    },
    {
      name: 'piloter_page',
      description: 'Agit sur la page web déjà ouverte (lecteur, résultats) : pause, lecture, choisir une vidéo, chercher un artiste, volume, défiler.',
      parameters: { type: 'OBJECT', properties: { commande: { type: 'STRING' } }, required: ['commande'] },
    },
    {
      name: 'camera',
      description: 'Contrôle la caméra du téléphone du créateur.',
      parameters: { type: 'OBJECT', properties: { action: { type: 'STRING', enum: ['ouvrir', 'fermer', 'inverser'] } }, required: ['action'] },
    },
    {
      name: 'voir_camera',
      description: "Observe réellement une image actuelle de la caméra du téléphone et répond à une question visuelle. À appeler avant toute affirmation sur ce qui est visible.",
      parameters: { type: 'OBJECT', properties: { question: { type: 'STRING' } } },
    },
    {
      name: 'theme',
      description: "Change le thème de l'interface.",
      parameters: { type: 'OBJECT', properties: { mode: { type: 'STRING', enum: ['jour', 'nuit'] } }, required: ['mode'] },
    },
    {
      name: 'jouer_musique',
      description: 'Joue un titre ou un artiste précis sur YouTube.',
      parameters: { type: 'OBJECT', properties: { titre: { type: 'STRING' } }, required: ['titre'] },
    },
    {
      name: 'recherche_web',
      description: "Cherche une réponse, un article ou une actualité sur le web et la donne à l'oral, SANS ouvrir le navigateur. À utiliser pour « trouve-moi un article », « cherche des infos sur… », toute question d'actualité.",
      parameters: { type: 'OBJECT', properties: { requete: { type: 'STRING', description: 'Le sujet à chercher, clair et autonome.' } }, required: ['requete'] },
    },
    {
      name: 'creer_tache_google',
      description: 'Crée réellement une tâche dans Google Tasks après validation locale.',
      parameters: {
        type: 'OBJECT', properties: { titre: { type: 'STRING' }, echeance: { type: 'STRING', description: 'Date ISO 8601 optionnelle.' } }, required: ['titre'],
      },
    },
    {
      name: 'creer_evenement_calendrier',
      description: 'Crée réellement un événement dans Google Calendar après validation locale.',
      parameters: {
        type: 'OBJECT',
        properties: {
          titre: { type: 'STRING' }, debut: { type: 'STRING', description: 'Date-heure ISO 8601.' },
          fin: { type: 'STRING', description: 'Date-heure ISO 8601.' }, lieu: { type: 'STRING' },
        },
        required: ['titre', 'debut', 'fin'],
      },
    },
    {
      name: 'chercher_contact',
      description: 'Cherche un contact déjà synchronisé par son nom (lecture seule, jamais Google en direct).',
      parameters: { type: 'OBJECT', properties: { nom: { type: 'STRING' } }, required: ['nom'] },
    },
    {
      name: 'envoyer_email',
      description: 'Envoie réellement un e-mail depuis le compte configuré après validation locale.',
      parameters: {
        type: 'OBJECT', properties: { destinataire: { type: 'STRING' }, sujet: { type: 'STRING' }, message: { type: 'STRING' } },
        required: ['destinataire', 'sujet', 'message'],
      },
    },
    {
      name: 'lire_journal',
      description: "Lit le journal d'activité RÉEL (missions, actions, bascules vocales, incidents) pour répondre à « qu'est-ce qui s'est passé / qu'as-tu fait ». Toute affirmation sur le passé doit venir de ce journal.",
      parameters: {
        type: 'OBJECT',
        properties: { limite: { type: 'NUMBER', description: "Nombre d'événements à lire, de 1 à 50." } },
      },
    },
    {
      name: 'lire_erreurs_techniques',
      description: "Lit les dernières erreurs techniques réelles et déjà expurgées de leurs secrets afin de diagnostiquer pourquoi une action n'a pas fonctionné.",
      parameters: {
        type: 'OBJECT',
        properties: { limite: { type: 'NUMBER', description: 'Nombre de lignes à lire, de 1 à 20.' } },
      },
    },
    {
      name: 'analyser_le_code',
      description: "Indexe le codebase du projet (fichiers, symboles, graphes d'appels et de dépendances) pour pouvoir répondre sur le code. À lancer avant toute question de code si l'index est vide.",
      parameters: { type: 'OBJECT', properties: {} },
    },
    {
      name: 'chercher_dans_le_code',
      description: 'Cherche un symbole, une fonction ou un sujet dans le codebase indexé et donne les fichiers correspondants.',
      parameters: {
        type: 'OBJECT',
        properties: { requete: { type: 'STRING', description: 'Ce qu\'il faut chercher (nom de fonction, sujet).' } },
        required: ['requete'],
      },
    },
    {
      name: 'statut_git_du_projet',
      description: 'Lit le statut git réel du projet : branche, fichiers modifiés, indexés, non suivis. Lecture seule — Mina ne pousse jamais.',
      parameters: { type: 'OBJECT', properties: {} },
    },
    {
      name: 'lancer_les_tests_du_projet',
      description: 'Lance la suite de tests réelle du projet (vitest) et rapporte les compteurs verts/rouges exacts. Long : prévenir avant de lancer.',
      parameters: { type: 'OBJECT', properties: {} },
    },
    {
      name: 'revue_du_code',
      description: 'Passe une revue statique (sécurité, style, logique) sur les fichiers indexés et rapporte les findings avec preuve fichier:ligne.',
      parameters: { type: 'OBJECT', properties: {} },
    },
    {
      name: 'generer_document',
      description: "Génère RÉELLEMENT un document PDF ou DOCX (rapport, lettre, note, liste) dans le dossier Documents/Mina Vision de Nasro, puis donne le chemin du fichier créé. Rédige toi-même un contenu complet et structuré à partir de la demande : « ## Titre de section » pour les sections, ligne vide entre paragraphes.",
      parameters: {
        type: 'OBJECT',
        properties: {
          format: { type: 'STRING', description: '« pdf » ou « docx ».' },
          titre: { type: 'STRING', description: 'Titre du document.' },
          contenu: { type: 'STRING', description: 'Contenu rédigé complet (sections « ## », paragraphes séparés par une ligne vide).' },
        },
        required: ['format', 'titre', 'contenu'],
      },
    },
    {
      name: 'utiliser_skill',
      description: "Active un skill Mina Vision installé ou intégré, vérifie son digest, ses capacités et son budget, puis charge ses instructions.",
      parameters: {
        type: 'OBJECT',
        properties: {
          nom: { type: 'STRING', description: 'Nom exact du skill si connu.' },
          demande: { type: 'STRING', description: "Demande du créateur, utilisée pour sélectionner automatiquement le skill si le nom n'est pas fourni." },
        },
      },
    },
    { name: 'fermer_navigateur', description: 'Ferme le navigateur de mission, arrête la musique en cours.', parameters: { type: 'OBJECT', properties: {} } },
    { name: 'connecter_gmail_navigateur', description: 'Ouvre un Chrome normal avec le profil persistant Mina Vision pour que le créateur se connecte manuellement à Gmail.', parameters: { type: 'OBJECT', properties: {} } },
    { name: 'decrire_capacites', description: "Décrit les capacités et l'état réel de Mina.", parameters: { type: 'OBJECT', properties: {} } },
  ],
}];

// Le stderr des workers vaut de l'or pour les VRAIS incidents, mais les avertissements de
// dépréciation Node pollueraient le journal d'erreurs — filtrés à la source.
const workerDiagnostic = (scope) => (message) => {
  if (/DeprecationWarning|ExperimentalWarning|--trace-deprecation/u.test(message)) return;
  technicalLog.record({ severity: 'warning', scope, code: 'worker_stderr', message });
};

// Conversation durable : chaque énoncé part en mémoire chiffrée, fail-soft absolu — coffre
// verrouillé ou jamais initialisé → la voix continue exactement comme avant, rien ne casse.
const rememberSpokenTurn = (role, text, engine) => {
  void memoryController?.rememberUtterance({ role, text, engine }).catch(() => {});
};

// Routage vocal partagé Gemini/Deepgram : quelle que soit l'oreille, un énoncé suit EXACTEMENT le
// même chemin — wake router, puis couche dialogue déterministe pour ce que le routeur ignore.
const buildUtteranceRoute = (engine) => {
  const router = createVoiceCommandRouter({
    onWake: (phrase) => send('mina:voice-wake', phrase),
    onCommand: (command) => send('mina:voice-command', command),
    onStop: () => { void stopEverything(); },
  });
  return (utterance) => {
    // Mots de contrôle (pause/reprise/stop) — en pause, l'énoncé est consommé : silence total.
    if (handleVoiceControlWords(utterance)) return;
    send('mina:voice-transcript', utterance);
    rememberSpokenTurn('owner', utterance, engine);
    const routed = router.push(utterance);
    if (routed.type === 'ignored') send('mina:voice-dialogue', utterance);
  };
};

// Oreilles de secours : Deepgram écoute quand la session Gemini est impossible (quota, réseau,
// clé) ; la bouche de secours (Kokoro) est déjà branchée dans say()/speak(). Boucle complète
// commandes+dialogue sans Gemini.
let deepgramFallback = null;
const startDeepgramFallback = async () => {
  if (deepgramFallback?.listening()) return { listening: true, engine: 'deepgram' };
  const config = currentConfig();
  if (!config.deepgramApiKey) throw new Error('deepgram_unconfigured');
  const route = buildUtteranceRoute('deepgram');
  deepgramFallback = createDeepgramStt({
    apiKey: config.deepgramApiKey,
    onTranscript: route,
    onError: (error) => technicalLog.record({
      severity: 'warning', scope: 'voice:deepgram', code: 'deepgram_error',
      message: String(error?.message ?? error).slice(0, 200),
    }),
  });
  await deepgramFallback.start();
  void activityJournal?.append('voice_engine', { engine: 'deepgram', reason: 'gemini_unavailable' });
  return { listening: true, engine: 'deepgram' };
};

const startVoice = async () => {
  if (voice) return { listening: true };
  if (deepgramFallback?.listening()) return { listening: true, engine: 'deepgram' };
  try {
    return await startGeminiVoice();
  } catch (error) {
    // Gemini impossible → bascule d'oreilles, jamais le silence. L'échec d'origine reste tracé.
    try { voice?.close(); } catch { /* session déjà morte */ }
    voice = null;
    const fallback = await startDeepgramFallback().catch(() => null);
    if (!fallback) throw error;
    technicalLog.record({
      severity: 'warning', scope: 'voice', code: 'gemini_unavailable_deepgram_fallback',
      message: String(error?.message ?? error).slice(0, 200),
    });
    return fallback;
  }
};

const startGeminiVoice = async () => {
  const config = requireRotatedCredentials();
  let modelSpeechBuffer = '';
  const routeUtterance = buildUtteranceRoute('gemini');
  // Gemini streams the transcription as partial fragments; routing each fragment used to make every
  // multi-word phrase unmatchable. Fragments are rebuilt into one utterance per silence window, and
  // anything the wake router doesn't claim still reaches the renderer's deterministic dialogue layer
  // (consent "oui", "active la caméra", musique…) via a dialogue-only channel with no mission fallback.
  const aggregator = createUtteranceAggregator({ onUtterance: routeUtterance });
  // Real state injected at session start so the model answers ANY state/capability question with
  // the truth of the moment, plus the tool-use rule for dynamic understanding of action requests.
  const snapshot = await capabilitySnapshot().catch(() => ({}));
  // Reprise de contexte : les derniers échanges réels, réinjectés pour que « comme hier » ait un
  // sens d'une session à l'autre. Coffre verrouillé → bloc vide, la session démarre pareil.
  const conversationBrief = await memoryController?.recentConversation({ limit: 20 })
    .then((recent) => (recent.length === 0 ? '' : [
      'Mémoire réelle de nos échanges précédents (appuie-toi dessus, n’invente rien au-delà) :',
      recent.map((item) => item.content).join(' | '),
    ].join(' ').slice(0, 1_800)))
    .catch(() => '') ?? '';
  const systemInstruction = [
    DEFAULT_SYSTEM_INSTRUCTION,
    composeInstructionState(snapshot),
    // Self-model dérivé : but courant, dernier travail, incertitudes, erreurs récentes du journal.
    composeSelfBrief(selfModel?.snapshot(), { recentErrors: technicalLogReader.read({ limit: 5 }) }),
    conversationBrief,
    'Quand le créateur demande une action réelle — quelle que soit sa formulation, même inédite —',
    "appelle l'outil correspondant (lancer_mission, selectionner_environnement, piloter_page, camera, voir_camera, theme, jouer_musique, recherche_web,",
    'creer_tache_google, creer_evenement_calendrier, chercher_contact, envoyer_email, lire_journal, lire_erreurs_techniques, analyser_le_code, chercher_dans_le_code, statut_git_du_projet, lancer_les_tests_du_projet, revue_du_code, generer_document, utiliser_skill, fermer_navigateur, decrire_capacites) en plus de tes règles précédentes. Un autre système peut',
    "avoir déjà lancé la même action : appeler l'outil reste correct, les doublons sont filtrés.",
    'RÈGLE DE VÉRITÉ SUR LE PASSÉ : pour toute question sur ce qui s\'est passé, ce que tu as fait ou tes erreurs,',
    "appelle d'abord lire_journal ou lire_erreurs_techniques et appuie-toi UNIQUEMENT sur leur contenu.",
    "Si le journal ne contient pas l'information, dis exactement : « mon journal ne le mentionne pas » — n'invente jamais un souvenir.",
  ].filter(Boolean).join(' ');
  voice = createGeminiLiveSession({
    apiKey: config.geminiApiKey,
    systemInstruction,
    tools: LIVE_TOOLS,
    // Cycle de vie de session observable (journal) + DERNIER filet anti-mutisme : la session
    // se reprend d'abord toute seule (sessionResumption côté provider) ; si la reprise est
    // épuisée (session_end remote_close), on redémarre la voix complète — Gemini d'abord,
    // oreilles Deepgram sinon. Avant : Mina restait sourde/muette jusqu'à un reboot manuel.
    onEvent: (event) => {
      send('mina:event', { ...event, type: `voice_${event.type}` });
      if (event.type === 'session_end' && event.reason === 'remote_close') {
        voice = null;
        const timer = setTimeout(() => {
          startVoice().catch((error) => send('mina:event', { type: 'voice_error', error: error.message }));
        }, 1_000);
        timer.unref?.();
      }
    },
    onToolCall: (call) => {
      // En pause : aucun outil ne s'exécute — le modèle reçoit un accusé neutre et rien ne bouge.
      if (pauseGate.isPaused()) {
        voice?.sendToolResponse({ id: call.id, name: call.name, response: { result: 'mina_en_pause' } }).catch(() => {});
        return;
      }
      if (call.name === 'voir_camera') {
        void analyzeLiveCamera(call.args?.question)
          .then((result) => voice?.sendToolResponse({
            id: call.id,
            name: call.name,
            response: { result: result.text, grounded: true, modelId: result.modelId },
          }))
          .catch((error) => {
            send('mina:event', { type: 'camera_vision_error', error: error.message });
            return voice?.sendToolResponse({
              id: call.id,
              name: call.name,
              response: { error: error.message, grounded: false },
            });
          })
          .catch(() => {});
        return;
      }
      if (call.name === 'creer_tache_google' || call.name === 'envoyer_email'
        || call.name === 'creer_evenement_calendrier' || call.name === 'chercher_contact') {
        const execute = {
          creer_tache_google: createGoogleTaskFromVoice,
          envoyer_email: sendEmailFromVoice,
          creer_evenement_calendrier: createCalendarEventFromVoice,
          chercher_contact: lookupContactFromVoice,
        }[call.name];
        void execute(call.args)
          .then((result) => voice?.sendToolResponse({ id: call.id, name: call.name, response: { result } }))
          .catch((error) => {
            send('mina:event', { type: 'action_error', action: { name: call.name }, error: error.message });
            return voice?.sendToolResponse({ id: call.id, name: call.name, response: { error: error.message } });
          })
          .catch(() => {});
        return;
      }
      if (call.name === 'lire_erreurs_techniques') {
        // Analyseur d'erreurs : chaque entrée part avec explication + remède en français —
        // Mina explique et propose au lieu de réciter des codes bruts.
        voice?.sendToolResponse({
          id: call.id,
          name: call.name,
          response: { errors: analyzeEntries(technicalLogReader.read({ limit: call.args?.limite })) },
        }).catch(() => {});
        return;
      }
      if (call.name === 'lire_journal') {
        void readJournalWithSensitiveText({ limit: Math.min(Math.max(Number(call.args?.limite) || 20, 1), 50) })
          .then((entries) => voice?.sendToolResponse({
            id: call.id,
            name: call.name,
            response: {
              events: entries.map((entry) => ({
                at: new Date(entry.at).toISOString(),
                kind: entry.kind,
                payload: typeof entry.payload === 'string' ? entry.payload.slice(0, 400) : entry.payload,
              })),
            },
          }))
          .catch((error) => voice?.sendToolResponse({ id: call.id, name: call.name, response: { error: error.message } }))
          .catch(() => {});
        return;
      }
      if (call.name === 'generer_document') {
        const respond = (response) => voice?.sendToolResponse({ id: call.id, name: call.name, response }).catch(() => {});
        void getDocumentGenerator().generate({
          format: String(call.args?.format ?? ''),
          title: String(call.args?.titre ?? ''),
          content: String(call.args?.contenu ?? ''),
        })
          .then((result) => {
            void activityJournal?.append('document_generated', { format: result.format, filePath: result.filePath, bytes: result.bytes });
            respond({ fichier: result.filePath, format: result.format, sections: result.sections, note: 'document réellement créé — donne le chemin à Nasro' });
          })
          .catch((error) => respond({ erreur: String(error?.message ?? error).slice(0, 300) }));
        return;
      }
      if (['analyser_le_code', 'chercher_dans_le_code', 'statut_git_du_projet', 'lancer_les_tests_du_projet', 'revue_du_code'].includes(call.name)) {
        // Outils Mina Code : mêmes services que le tableau de bord, réponse asynchrone bornée.
        const respond = (response) => voice?.sendToolResponse({ id: call.id, name: call.name, response }).catch(() => {});
        void (async () => {
          const services = getCodeServices();
          if (call.name === 'analyser_le_code') {
            const report = await services.indexer.fullIndex({});
            return { indexed: report.indexed, total: report.total, erreurs_de_parse: report.errors.length };
          }
          if (call.name === 'chercher_dans_le_code') {
            const hits = await services.search.search(String(call.args?.requete ?? '').slice(0, 200), { maxResults: 5 });
            if (hits.length === 0) return { resultats: [], note: 'aucun résultat — index vide ? lancer analyser_le_code d\'abord' };
            return { resultats: hits.map((hit) => ({ symbole: hit.symbol?.name ?? null, fichier: hit.file, kind: hit.symbol?.kind ?? null })) };
          }
          if (call.name === 'statut_git_du_projet') {
            if (!(await services.gitClient.isRepository())) return { depot_git: false, note: 'ce dossier n\'est pas un dépôt git' };
            const status = await services.gitStatus.status();
            return { depot_git: true, branche: status.branch, propre: status.clean, indexes: status.staged.length, modifies: status.modified.length, non_suivis: status.untracked.length };
          }
          if (call.name === 'lancer_les_tests_du_projet') {
            const run = await services.testRunner.runAll({ timeout: 300_000 });
            return { framework: run.framework, verts: run.passed, rouges: run.failed, total: run.total, crash_du_lanceur: run.crashed === true, echecs: (run.failures ?? []).slice(0, 5) };
          }
          const files = services.indexer.indexedFiles().slice(0, 20);
          if (files.length === 0) return { erreur: 'index vide — lancer analyser_le_code d\'abord' };
          const report = await services.reviewer.review({ files });
          return {
            fichiers_examines: files.length,
            findings: report.findings.length,
            par_severite: report.summary,
            extraits: report.findings.slice(0, 8).map((finding) => finding.proof),
          };
        })()
          .then((response) => respond(response))
          .catch((error) => respond({ erreur: String(error?.message ?? error).slice(0, 300) }));
        return;
      }
      if (call.name === 'utiliser_skill') {
        if (!skillRouter) {
          voice?.sendToolResponse({ id: call.id, name: call.name, response: { error: 'skill_runtime_unavailable' } }).catch(() => {});
          return;
        }
        const activationId = `voice-${randomUUID()}`;
        void skillRouter.activate({
          ...(call.args?.nom ? { name: String(call.args.nom) } : { query: String(call.args?.demande ?? '') }),
          channel: 'voice',
          workSessionId: activationId,
          sessionId: activationId,
          availableCapabilities: ['conversation.reply_draft', 'files.read', 'research.file', 'research.web', 'sandbox.propose'],
          requestedBudget: { maxDurationMs: 30_000, maxCostMicros: 1_000, maxTokens: 4_096 },
        }).then((result) => {
          if (result.decision !== 'activated') return voice?.sendToolResponse({ id: call.id, name: call.name, response: result });
          const references = Object.fromEntries(Object.entries(result.loaded.references ?? {})
            .map(([name, content]) => [name, String(content).slice(0, 8_000)]));
          const response = {
            decision: result.decision,
            skill: result.skill.name,
            version: result.skill.version,
            digest: result.skill.digest,
            instructions: String(result.loaded.body).slice(0, 24_000),
            references,
          };
          skillSessions?.close(result.session.id, 'instructions_delivered');
          return voice?.sendToolResponse({ id: call.id, name: call.name, response });
        }).catch((error) => voice?.sendToolResponse({
          id: call.id, name: call.name, response: { error: error.message },
        })).catch(() => {});
        return;
      }
      send('mina:voice-intent', { name: call.name, args: call.args });
      voice?.sendToolResponse({ id: call.id, name: call.name, response: { result: 'transmis' } }).catch(() => {});
    },
    onTranscript: (fragment) => {
      // Mots de contrôle sur les FRAGMENTS partiels : pause/stop coupent au moment du mot,
      // pas à la fin de l'énoncé ; en pause, rien n'atteint l'agrégateur (silence total).
      if (handleVoiceControlWords(fragment)) return;
      aggregator.push(fragment);
    },
    // Ce que Mina DIT (réponses libres Gemini) : agrégé par tour puis mémorisé — les répliques
    // déterministes [DIS] sont déjà couvertes par le handler mina:voice-say.
    onModelTranscript: (fragment, { turnComplete } = {}) => {
      modelSpeechBuffer += fragment;
      if (!turnComplete) return;
      // Fin de tour modèle : la suppression post-« stop » se relâche — le prochain tour repart propre.
      speechGate.noteTurnComplete();
      const spoken = modelSpeechBuffer.trim();
      modelSpeechBuffer = '';
      if (spoken && !spoken.startsWith('[DIS]')) rememberSpokenTurn('mina', spoken, 'gemini');
    },
    onAudio: (audio, mimeType) => {
      // Après « stop », les chunks restants du tour interrompu sont jetés — sinon la file locale
      // rejoue la fin de la phrase coupée. En pause : silence total, tout est jeté.
      if (speechGate.shouldSuppress() || pauseGate.isPaused()) return;
      send('mina:voice-audio', { audio, mimeType });
    },
    onInterrupted: () => send('mina:voice-interrupted'),
    onError: (error) => send('mina:event', { type: 'voice_error', error: error.message }),
  });
  await voice.connect();
  void activityJournal?.append('voice_engine', { engine: 'gemini' });
  return { listening: true };
};

// Purely informational, static content — no preload/API surface needed, so it carries none: the
// window has nothing to call back into the main process for beyond loading its own local file.
const openHelpWindow = async () => {
  if (helpWindow && !helpWindow.isDestroyed()) {
    helpWindow.show();
    helpWindow.focus();
    return { opened: true };
  }
  helpWindow = new BrowserWindow({
    width: 900,
    height: 760,
    minWidth: 640,
    minHeight: 480,
    title: 'Mina Vision — Guide',
    backgroundColor: '#eaf1ef',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  helpWindow.removeMenu();
  helpWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  helpWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== helpWindow.webContents.getURL()) event.preventDefault();
  });
  helpWindow.on('closed', () => { helpWindow = null; });
  await helpWindow.loadFile(path.join(UI_DIR, 'help.html'));
  helpWindow.show();
  return { opened: true };
};

const registerIpc = () => {
  ipcMain.handle('mina:technical-log:list', () => technicalLog.list());
  ipcMain.handle('mina:technical-log:clear', () => technicalLog.clear());
  ipcMain.handle('mina:technical-log:aggregate', () => errorAggregator.list());
  ipcMain.handle('mina:technical-log:record', (_event, request) => {
    if (!request || Object.keys(request).sort().join(',') !== 'code,message,scope,severity'
      || !['error', 'warning'].includes(request.severity)
      || !/^[a-z0-9:_-]{1,120}$/iu.test(request.scope ?? '')
      || !/^[a-z0-9:_-]{1,120}$/iu.test(request.code ?? '')
      || typeof request.message !== 'string') throw new TypeError('technical_log_request_invalid');
    return technicalLog.record(request);
  });
  ipcMain.handle('mina:help:open', () => openHelpWindow());
  ipcMain.handle('mina:browser:close', () => closeBrowserExecutor());
  ipcMain.handle('mina:browser:google-login', () => openGoogleBrowserLogin());
  ipcMain.handle('mina:youtube-search', async (_event, request) => {
    if (!request || Object.keys(request).sort().join(',') !== 'maxResults,query'
      || typeof request.query !== 'string' || request.query.length < 1 || request.query.length > 200
      || !Number.isInteger(request.maxResults) || request.maxResults < 1 || request.maxResults > 10) {
      throw new TypeError('youtube_search_request_invalid');
    }
    return (await getYouTubeDataClient()).searchVideos(request.query, { maxResults: request.maxResults });
  });
  ipcMain.handle('mina:status', async () => {
    try {
      const config = currentConfig();
      return { ok: true, config: redactConfig(config), smokeMode: SMOKE_MODE };
    } catch (error) {
      return { ok: false, error: error.message, smokeMode: SMOKE_MODE };
    }
  });
  ipcMain.handle('mina:start', (_event, request) => startMission(request));
  // Voice spoken DURING a mission steers the running one (same window, mouse/keyboard) instead of
  // spawning a second mission. queued:false tells the renderer to fall back to a fresh mission.
  ipcMain.handle('mina:mission-guide', (_event, text) => {
    const line = String(text ?? '').trim().slice(0, 4_000);
    if (!line) return { queued: false, reason: 'empty' };
    if (!activeOrchestrator?.isRunning?.()) return { queued: false, reason: 'no_mission' };
    return { queued: activeOrchestrator.pushGuidance(line) === true };
  });
  ipcMain.handle('mina:dental', (_event, request) => runDentalMission(request));
  ipcMain.handle('mina:stop', () => stopEverything());
  ipcMain.handle('mina:phone-detect', async () => {
    const bridge = getPhoneBridge();
    // Découverte Wi-Fi AVANT le scan : connecte les téléphones qui s'annoncent en débogage sans
    // fil (Android 11+), donc « Détecter » les trouve sans câble USB. Best-effort — mDNS absent
    // n'empêche pas la détection USB. detect() vérifie ensuite l'identité signée : un appareil
    // du réseau qui n'est pas un téléphone Mina reste ignoré.
    const wifi = await bridge.discoverWifiPhones().catch(() => null);
    if (wifi?.connected > 0) void activityJournal?.append('phone_wifi_discovered', { connected: wifi.connected });
    return bridge.detect();
  });
  ipcMain.handle('mina:phone-camera', async () => {
    return startLiveCamera();
  });
  ipcMain.handle('mina:phone-camera-stop', () => stopLiveCamera());
  ipcMain.handle('mina:sms-send-confirmed', async (_event, request) => {
    if (!request || Object.keys(request).sort().join(',') !== 'recipientE164,sourceMessageId,text'
      || !/^[A-Za-z0-9._:-]{1,160}$/u.test(request.sourceMessageId ?? '')
      || !/^\+[1-9][0-9]{7,14}$/u.test(request.recipientE164 ?? '')
      || typeof request.text !== 'string' || request.text.length < 1 || request.text.length > 1_600
      || request.text.includes('\0')) throw new TypeError('sms_confirmed_request_invalid');
    const confirmation = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'Confirmation SMS Mina Vision',
      message: `Envoyer ce SMS à ${request.recipientE164} ?`,
      detail: request.text.slice(0, 500),
      buttons: ['Refuser', 'Envoyer une fois'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (confirmation.response !== 1) throw new Error('sms_confirmation_refused');
    const router = await getSmsRouter();
    return router.send({
      requestId: request.sourceMessageId, from: currentConfig().sms.httpsms.fromNumber, to: request.recipientE164, content: request.text,
    });
  });
  ipcMain.handle('mina:phone-sync-messages', () => syncPhoneMessages());
  ipcMain.handle('mina:sms-policy-status', () => ({ mode: getSmsSendPolicy().mode }));
  // HTTPSMS operational status — no secrets, only booleans/enums the UI and the record can show.
  ipcMain.handle('mina:sms-status', async () => {
    const httpsms = currentConfig().sms.httpsms;
    const status = {
      httpsmsConfigured: httpsms.enabled,
      routingMode: httpsms.mode,
      webhookListening: Boolean(httpsmsWebhookServer),
      webhookPort: httpsms.webhookPort,
      nativeReady: true,
    };
    if (httpsms.enabled) {
      try {
        const router = await getSmsRouter();
        status.httpsmsReachable = router ? undefined : false;
      } catch { status.httpsmsReachable = false; }
    }
    return status;
  });
  // Immediate, revocable kill switch for any future automatic SMS sending — see getSmsSendPolicy above.
  ipcMain.handle('mina:sms-policy-revoke', () => { getSmsSendPolicy().revokeAutomation(); return { mode: getSmsSendPolicy().mode }; });
  ipcMain.handle('mina:sms-policy-reactivate', () => { getSmsSendPolicy().reactivate(); return { mode: getSmsSendPolicy().mode }; });
  ipcMain.handle('mina:voice-start', () => startVoice());
  // Deterministic replies come back through the natural Gemini voice ("[DIS]" verbatim readback);
  // spoken:false lets the renderer fall back to local TTS only when no live session exists.
  ipcMain.handle('mina:capabilities', () => capabilitySnapshot());
  // Catalogue structuré (amélioration A) : readiness / health / capabilities séparés, budgets
  // opérationnels inclus (amélioration D) — même snapshot réel que le brief vocal.
  ipcMain.handle('mina:capability-catalog', async () => {
    const config = currentConfig();
    return composeCapabilityCatalog(await capabilitySnapshot().catch(() => ({})), {
      budgets: composeOperationalBudgets({
        mission: { maxActions: config.maxActions, timeoutMs: config.missionTimeoutMs },
      }),
    });
  });
  // « Trouve-moi un article » : réponse web directe (API avec recherche intégrée), jamais de
  // navigateur — la clé Gemini existante suffit, le service borne requête, délai et sources.
  ipcMain.handle('mina:web-answer', async (_event, payload) => getWebAnswerService().answer({ query: payload?.query }));
  // Voix locale naturelle (Kokoro) — remplace le SAPI robotique quand la session Gemini n'existe
  // pas. Le PCM revient par le canal audio normal ; ici on ne renvoie que l'accusé.
  // Le journal complet, lisible par la voix (outil lire_journal) ET par l'interface.
  ipcMain.handle('mina:journal-read', async (_event, payload) => (
    readJournalWithSensitiveText({ limit: payload?.limit, kinds: payload?.kinds })
  ));
  // Domaine Mina Code : UN SEUL jeu de services, construit PARESSEUSEMENT au premier usage
  // (zéro coût au boot), partagé entre l'IPC du tableau de bord et les outils vocaux. Racine
  // analysée = le projet Mina Vision lui-même ; les écritures git restent refusées tant
  // qu'aucun flux de confirmation dédié n'existe (confirm par défaut = false, lecture libre).
  registerCodeIpc({
    ipcMain,
    buildServices: getCodeServices,
    onEvent: (event) => void activityJournal?.append('code_ipc_error', event),
  });
  ipcMain.handle('mina:local-tts', async (_event, payload) => {
    if (pauseGate.isPaused()) return { spoken: false, reason: 'paused' };
    const text = String(payload?.text ?? '').trim().slice(0, 1_200);
    if (!text) return { spoken: false, reason: 'empty' };
    const result = await getLocalVoice().speak(text);
    if (result.chunks > 0) rememberSpokenTurn('mina', text, 'kokoro');
    return { spoken: result.chunks > 0, chunks: result.chunks };
  });
  ipcMain.handle('mina:voice-say', async (_event, text) => {
    if (pauseGate.isPaused()) return { spoken: false, reason: 'paused' };
    const line = String(text ?? '').replace(/\s+/gu, ' ').trim().slice(0, 1_200);
    if (!line) return { spoken: false, reason: 'empty' };
    if (!voice) return { spoken: false, reason: 'voice_inactive' };
    await voice.sendText(`${VOICE_READBACK_PREFIX}${line}`);
    rememberSpokenTurn('mina', line, 'dis');
    return { spoken: true };
  });
  ipcMain.handle('mina:voice-stop', () => {
    voice?.close();
    voice = null;
    deepgramFallback?.close();
    deepgramFallback = null;
    return { listening: false };
  });
  ipcMain.handle('mina:session-state', () => minaCore?.getSessionState() ?? null);
  ipcMain.handle('mina:claims', () => minaCore?.getClaims() ?? []);
  ipcMain.handle('mina:grounding-status', () => minaCore?.getGroundingStatus() ?? null);
  ipcMain.handle('memory.status', () => memoryController?.status() ?? {
    locked: true, semanticMode: 'unavailable', backupState: 'disabled', researchEvidence: 0,
  });
  ipcMain.handle('memory.initialize', () => memoryController.initialize());
  ipcMain.handle('memory.unlock', (_event, request) => memoryController.unlock(request));
  ipcMain.handle('memory.lock', () => {
    // Verrouiller la mémoire coupe AUSSI le canal téléphone : sans clé maîtresse il n'y a plus
    // de clé d'époque, donc plus de déchiffrement possible — autant l'annoncer franchement.
    chatMasterKey?.fill(0);
    chatMasterKey = null;
    void chatChannel?.stop();
    return memoryController.lock();
  });

  // Canal `mina_app` — état, appairage et révocation. Aucune de ces routes ne transporte de
  // contenu de conversation : elles ne servent qu'à décider QUI a le droit de parler à Mina.
  ipcMain.handle('mina:chat:status', () => chatChannel?.status() ?? {
    listening: false, address: null, vaultUnlocked: Boolean(chatMasterKey), pairingOpen: false,
    keyEpoch: 0, connectedDevices: [], devices: [], lastError: 'canal non démarré',
  });
  ipcMain.handle('mina:chat:openPairing', () => {
    if (!chatChannel) return { ok: false, reason: 'canal_non_demarre' };
    const opened = chatChannel.openPairing();
    return { ok: true, ...opened };
  });
  ipcMain.handle('mina:chat:closePairing', () => {
    chatChannel?.closePairing();
    return { ok: true };
  });
  ipcMain.handle('mina:chat:revoke', async (_event, request) => {
    const deviceId = String(request?.deviceId ?? '');
    if (!/^[A-Za-z0-9._:-]{1,160}$/u.test(deviceId)) return { ok: false, reason: 'identifiant_invalide' };
    if (!chatChannel) return { ok: false, reason: 'canal_non_demarre' };
    return chatChannel.revoke(deviceId);
  });
  ipcMain.handle('memory.search', (_event, request) => memoryController.search(request));
  ipcMain.handle('memory.proposeForget', (_event, request) => memoryController.proposeForget(request));
  ipcMain.handle('research.readFile', async (_event, request) => {
    try {
      return await memoryController.readFile(request);
    } catch (error) {
      if (error.message !== 'file_confirmation_required') throw error;
      const confirmed = await confirmSensitiveAction({
        reason: 'Ce fichier est hors des racines approuvées de Mina Vision.',
        action: { name: 'read_file_once', path: request?.path },
      });
      if (!confirmed) throw new Error('file_confirmation_refused');
      return memoryController.readFile({ ...request, confirmed: true });
    }
  });
  ipcMain.handle('research.readWeb', async (_event, request) => {
    if (request?.operation === 'index' && request.indexingAuthorized !== true) {
      const confirmed = await confirmSensitiveAction({
        reason: 'Indexer cette page web dans la mémoire locale chiffrée ?',
        action: { name: 'index_web', url: request?.url },
      });
      if (!confirmed) throw new Error('web_indexing_confirmation_refused');
      return memoryController.readWeb({ ...request, indexingAuthorized: true });
    }
    return memoryController.readWeb(request);
  });
  ipcMain.handle('mina:printing:discover', () => printerRegistry.discover());
  ipcMain.handle('mina:printing:approve', async (_event, { printerId } = {}) => {
    const approved = await confirmSensitiveAction({
      reason: `Autoriser l'imprimante « ${printerId} » pour Mina Vision ?`,
      action: { name: 'printer.approve', printerId },
    });
    if (!approved) throw new Error('printer_approval_refused');
    return printerRegistry.approvePrinter(printerId);
  });
  ipcMain.handle('mina:printing:print-file', async (_event, { printerId, filePath, copies = 1 } = {}) => {
    if (typeof filePath !== 'string' || !filePath) throw new TypeError('print_file_path_required');
    if (!(await printerRegistry.isApproved(printerId))) throw new Error('printer_not_approved');
    const approved = await confirmSensitiveAction({
      reason: `Imprimer « ${path.basename(filePath)} » sur ${printerId} ?`,
      action: { name: 'print.job', filePath, printerId },
    });
    if (!approved) throw new Error('print_confirmation_refused');
    // digest carries the resolved file path directly until the document-evidence-store pipeline
    // (Task 5 remainder — intake/classify/form/convert) is wired: no content-addressed store to
    // resolve a real digest from yet, so a real, existing file path is the honest interim contract.
    const proposal = await printService.proposePrint({ digest: filePath, printerId, pages: null, copies });
    const job = await printService.submit(proposal);
    // Real spooler poll: proves the printer actually accepted it, not just that we asked.
    const status = await printService.reconcile(job.jobId);
    return Object.freeze({ ...job, ...status });
  });
  // Task 9 : UN SEUL point d'enregistrement des domaines — garde sender-frame (seule la fenêtre
  // principale peut invoquer) + limite de payload générique 1 MiB, 16 MiB pour l'enrôlement
  // caméra. Les canaux directs de main.mjs (au-dessus) restent en place ; la consolidation
  // complète vit dans CORE_CHANNELS de register-ipc.mjs.
  registerMinaIpc({
    ipcMain,
    controllers: {
      skillsSandbox: skillsSandboxController,
      settings: settingsController,
      analytics: analyticsController,
      ...(mailController ? { mail: mailController } : {}),
      ...(homeController ? { home: homeController } : {}),
      ...(cameraController ? { camera: cameraController } : {}),
      ...(personalControllers ? { personal: personalControllers } : {}),
      ...(documentController ? { document: documentController } : {}),
      ...(personalityController ? { personality: personalityController } : {}),
    },
    isValidSender: (event) => {
      const frame = mainWindow?.webContents?.mainFrame;
      return Boolean(frame) && event.senderFrame === frame;
    },
    maxPayloadBytes: 1024 * 1024,
    payloadLimits: { 'mina:camera:enroll': 16 * 1024 * 1024 },
  });
  // Catalogue de vérité (Task 8) : lecture seule, état réel de CHAQUE domaine avec raison.
  ipcMain.handle('mina:capabilities:list', () => runtimeCapabilityCatalog?.list() ?? []);
  // Démarrage automatique avec Windows : clé Run de l'utilisateur courant via l'API Electron.
  ipcMain.handle('mina:startup:status', () => startupManager.status());
  ipcMain.handle('mina:startup:set', (_event, payload) => startupManager.set(payload?.enabled === true));
  ipcMain.on('mina:voice-input', (_event, payload) => {
    const buffer = Buffer.from(payload ?? []);
    if (buffer.length === 0 || buffer.length > 1_000_000) return;
    if (voice) {
      voice.sendPcm16(buffer).catch((error) => send('mina:event', { type: 'voice_error', error: error.message }));
      return;
    }
    // Sans session Gemini, les oreilles de secours Deepgram consomment le même flux micro —
    // avant, ces chunks étaient simplement jetés et Mina devenait sourde.
    deepgramFallback?.sendPcm16(buffer);
  });
};

const createWindow = async () => {
  mainWindow = new BrowserWindow({
    width: 1_080,
    height: 760,
    minWidth: 820,
    minHeight: 640,
    backgroundColor: '#eaf1ef',
    title: 'Mina Vision — Agent local',
    show: false,
    webPreferences: {
      preload: path.join(UI_DIR, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.removeMenu();
  // No allowlist: Mina's renderer never legitimately opens a new window or navigates away from its
  // own index.html — browsing goes through the browser executor (Playwright), never the app shell.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) event.preventDefault();
  });
  await loadAndShowWindow(mainWindow, path.join(UI_DIR, 'index.html'));
  if (SMOKE_MODE) setTimeout(() => app.quit(), 1_200);
};

app.whenReady().then(async () => {
  // Self-model persistant : chargé avant tout — il survit aux redémarrages et n'est alimenté que
  // par les événements réels traversant send().
  selfModel = createSelfModel({
    statePath: path.join(app.getPath('userData'), 'self-model.json'),
    readFile,
    writeFile,
  });
  await selfModel.load();
  // R-04 : INSPECTION seule au boot — harden() automatique RETIRÉ après incident réel du
  // 2026-07-22 : icacls /inheritance:r /T sur des fichiers OUVERTS échoue partiellement
  // (héritage coupé, grants non posés) et rend le journal illisible même pour Nasro. Le
  // durcissement reste disponible via createLocalPathPermissions().harden(), à lancer app
  // FERMÉE uniquement ; ici on ne fait que signaler un groupe trop large, sans rien modifier.
  void createLocalPathPermissions().inspect(path.join(app.getPath('userData'), 'logs'))
    .then((report) => {
      if (report.broadGroups.length > 0) {
        technicalLog.record({ severity: 'info', scope: 'security', code: 'journal_acl_broad_groups', message: report.broadGroups.join(', ') });
      }
    })
    .catch(() => {});
  sensitiveJournalStore = createSensitiveJournalStore({
    directory: path.join(app.getPath('userData'), 'logs'),
    appendFile, readFile, readdir, rm, mkdir,
  });
  activityJournal = createActivityJournal({
    directory: path.join(app.getPath('userData'), 'logs'),
    appendFile, readFile, readdir, rm, mkdir,
    sensitiveSink: sensitiveJournalStore,
  });
  void activityJournal.purge();
  void sensitiveJournalStore.purge();
  void activityJournal.append('boot', { version: app.getVersion?.() ?? 'dev' });
  // Deny-by-default stays the rule. 'media' is the microphone (voice). 'fullscreen' is the voice
  // animation filling the screen on an explicit owner click — it grants access to nothing, only
  // changes how Mina's OWN window is displayed, and Escape always exits. Without it the browser
  // rejects requestFullscreen() and the button silently does nothing.
  const ALLOWED_PERMISSIONS = new Set(['media', 'fullscreen']);
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission));
  });
  const sessionStore = createSessionStore();
  const sessionManager = createSessionManager({ store: sessionStore });
  const claimLedger = createClaimLedger();
  const nativeBinding = nativeCacheCandidates({ rootDir: ROOT_DIR })
    .map((root) => path.join(root, `electron-v${process.versions.modules}`, 'better_sqlite3.node'))
    .find((candidate) => existsSync(candidate));
  if (!nativeBinding) throw new Error(`Binding SQLite Electron ABI ${process.versions.modules} introuvable.`);
  sqliteNativeBinding = nativeBinding;
  // R-04 : les racines de lecture APPROUVÉES (sans confirmation) se limitent au projet et au
  // workspace documents. Tout autre chemin reste lisible en one-shot CONFIRMÉ (mécanique
  // file-policy existante) ; l'indexation hors racine reste interdite. Des racines
  // supplémentaires ne s'ajoutent que par choix explicite : MINA_APPROVED_READ_ROOTS
  // (séparateur « ; »).
  const extraReadRoots = String(process.env.MINA_APPROVED_READ_ROOTS ?? '')
    .split(';')
    .map((root) => root.trim())
    .filter(Boolean);
  try {
    mkdirSync(path.join(app.getPath('documents'), 'Mina Vision'), { recursive: true });
  } catch { /* le workspace sera créé par ensure() ; la racine entrera au prochain boot */ }
  const approvedRoots = [...new Set([
    ROOT_DIR,
    path.join(app.getPath('documents'), 'Mina Vision'),
    ...extraReadRoots,
  ])].filter((root) => existsSync(root));
  minaFileWorkspace = createMinaFileWorkspace({ root: path.join(app.getPath('documents'), 'Mina Vision') });
  printerRepository = createJsonRepository({
    filename: path.join(app.getPath('userData'), 'mina-printers.sqlite'), table: 'printers', nativeBinding,
  });
  printerRegistry = createPrinterRegistry({ spooler: createWindowsPrintSpooler({}), repository: printerRepository });
  printService = createPrintService({
    printerRegistry,
    spooler: createWindowsPrintSpooler({}),
    // The spooler's own "no longer in the live OS queue" observation IS the effect evidence here
    // — Windows itself is the source of truth, not a simulated check.
    actionVerifier: { verify: async ({ receipt }) => ({ confirmed: receipt?.status === 'completed' }) },
    clock: Date.now,
  });
  await minaFileWorkspace.ensure();
  hostWritePolicy = createHostWritePolicy({
    trustedRoots: [
      ROOT_DIR,
      app.getPath('userData'),
      path.join(app.getPath('documents'), 'Mina Vision'),
      storageRoots.cacheRoot,
      // Racines supplémentaires : UNIQUEMENT celles que l'utilisateur déclare lui-même via
      // MINA_TRUSTED_WRITE_ROOTS. Aucune racine machine en dur — une installation neuve
      // n'hérite jamais des dossiers de confiance d'une autre (R-06 généralisé).
      ...storageRoots.extraTrustedRoots,
    ],
    confirmLocal: confirmSensitiveAction,
  });
  const keyring = createKeyring({
    storage: createKeyringFileStorage({ filename: path.join(app.getPath('userData'), 'mina-keyring.json') }),
    safeStorage,
  });
  providerSecretStore = createProviderSecretStore({ keyring });
  const envPath = path.join(ROOT_DIR, '.env');
  const envStore = createEnvDocumentStore({
    path: envPath,
    allowedKeys: new Set(NON_SENSITIVE_CONFIG_KEYS),
    readText: async (filename) => {
      try { return await readFile(filename, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
    },
    writeAtomic: async (filename, content) => {
      const temporary = `${filename}.${process.pid}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
        await rename(temporary, filename);
      } finally {
        await rm(temporary, { force: true }).catch(() => {});
      }
    },
  });
  const persistedConfig = createConfigService({ env: process.env, secretStore: providerSecretStore, envStore });
  const liveConfigService = Object.freeze({
    snapshot: () => persistedConfig.snapshot(),
    validateProvider: (providerId) => persistedConfig.validateProvider(providerId),
    updateNonSensitive: async (patch) => {
      const state = await persistedConfig.updateNonSensitive(patch);
      for (const [key, value] of Object.entries(patch)) process.env[key] = String(value);
       if (runtime) await runtime.close();
       runtime = null;
       telegramTextGeneratorInstance = null;
       return state;
    },
  });
  settingsController = createSettingsController({
    configService: liveConfigService,
    secretStore: providerSecretStore,
    providerTester: async (providerId, { signal } = {}) => {
      const configured = await persistedConfig.validateProvider(providerId);
       if (providerId === 'lmStudio') {
        const state = await probeLmStudio({ config: currentConfig().providers.lmStudio, signal });
        if (!state.ready) throw new Error(state.reason);
         return Object.freeze({ ok: true, configured: true, providerId, ...state });
       }
       if (providerId === 'youtube') {
         const apiKey = await providerSecret('youtube', process.env.YOUTUBE_API_KEY);
         return createYouTubeDataClient({ apiKey }).test({ signal });
       }
      return Object.freeze({ ok: true, configured: true, providerId, baseUrl: configured.baseUrl, model: configured.model });
    },
    providerMetadata: {
      gemini: { locality: 'cloud', network: 'internet' },
      deepseek: { locality: 'cloud', network: 'internet' },
      openrouter: { locality: 'cloud', network: 'internet' },
      modal: { locality: 'cloud', network: 'internet' },
       huggingface: { locality: 'cloud', network: 'internet' },
       youtube: { locality: 'cloud', network: 'internet' },
       lmStudio: { locality: 'local', network: 'loopback' },
    },
  });
  usageDatabase = openMemoryDatabase({
    filename: path.join(app.getPath('userData'), 'mina-usage.sqlite'),
    nativeBinding,
    securePermissions: () => {},
  });
  applyUsageMigrations(usageDatabase);
  const analyticsQuery = createAnalyticsQuery({ db: usageDatabase });
  const budgetGuard = createBudgetGuard();
  analyticsController = createAnalyticsController({
    analyticsQuery,
    budgetGuard,
    confirmLocal: confirmSensitiveAction,
    selectExportPath: async ({ format, suggestedName }) => {
      const selected = await dialog.showSaveDialog(mainWindow, {
        title: 'Exporter les analyses Mina Vision',
        defaultPath: suggestedName,
        filters: [{ name: format.toUpperCase(), extensions: [format] }],
      });
      return selected.canceled ? null : selected.filePath;
    },
    writer: {
      writeAtomic: async ({ path: filename, content, encoding }) => {
        const authorizedFilename = await hostWritePolicy.authorize(filename);
        const temporary = `${authorizedFilename}.${process.pid}.${randomUUID()}.tmp`;
        try {
          await writeFile(temporary, content, { encoding, flag: 'wx' });
          await rename(temporary, authorizedFilename);
          return { bytes: Buffer.byteLength(content, encoding) };
        } finally {
          await rm(temporary, { force: true }).catch(() => {});
        }
      },
    },
  });
  memoryController = createMemoryRuntimeController({
    keyring,
    confirmLocal: confirmSensitiveAction,
    buildServices: (masterKey) => {
      // Le déverrouillage du coffre arme AUSSI la couche 2 du journal : clé dédiée dérivée par
      // HKDF (jamais la clé maître elle-même). Le tampon accumulé pendant le verrouillage est
      // chiffré et vidé ici.
      chatMasterKey = Buffer.from(masterKey);
      try {
        const journalKey = Buffer.from(hkdfSync('sha256', Buffer.from(masterKey), Buffer.from('Mina Vision local memory v1', 'utf8'), Buffer.from('journal-sensible', 'utf8'), 32));
        sensitiveJournalStore?.enableEncryption(journalKey);
      } catch { /* la couche 2 ne bloque jamais le déverrouillage mémoire */ }
      const config = currentConfig();
      const embedder = config.providers.lmStudio.enabled && config.providers.lmStudio.embeddingModel
        ? createLmStudioEmbeddingProvider({
          baseURL: config.providers.lmStudio.baseUrl,
          model: config.providers.lmStudio.embeddingModel,
          timeoutMs: config.providers.lmStudio.timeoutMs,
        })
        : null;
      return createMemoryServices({
        masterKey,
        databasePath: path.join(app.getPath('userData'), 'mina-memory.sqlite'),
        approvedRoots,
        getWebPage: async () => (await getBrowserExecutor()).getPage(),
        backupConfigured: Boolean(process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_STORAGE_BUCKET),
        nativeBinding,
        embedder,
      });
    },
  });
  // Déverrouillage automatique au démarrage (le wrap DPAPI réparé le permet). Un échec n'est
  // PLUS avalé en silence : il part au journal technique ET au journal d'activité — c'est la
  // seule façon de savoir POURQUOI « la mémoire est encore bloquée ».
  await memoryController.unlock()
    .then(() => void activityJournal?.append('memory_auto_unlock', { ok: true, locked: memoryController.status()?.locked }))
    .catch((error) => {
      const message = String(error?.message ?? error).slice(0, 300);
      technicalLog.record({ severity: 'warning', scope: 'memory', code: 'memory_auto_unlock_failed', message });
      void activityJournal?.append('memory_auto_unlock', { ok: false, error: message });
    });

  // Canal `mina_app` (constitution : conversation, mémoire et médias depuis un appareil appairé).
  // Il ne démarre QUE si le coffre est ouvert : les clés d'époque en dérivent, et l'identité du
  // PC est chiffrée par lui. Coffre fermé, on ne fait pas semblant d'écouter.
  try {
    if (chatMasterKey) {
      const chatIdentity = await loadOrCreatePcChatIdentity({
        filePath: path.join(app.getPath('userData'), 'chat-pc-identity.json'),
        masterKey: chatMasterKey,
        readFile,
        writeFile,
      });
      // Relais Firebase : chemin de secours quand le téléphone n'est pas sur le réseau du PC.
      // Il ne s'active QUE si google-services.json est présent — sans lui, le canal reste
      // strictement local et l'onglet Système l'annonce, plutôt que de laisser croire à un
      // secours qui n'existe pas.
      let chatFirestore = null;
      try {
        const googleServicesPath = process.env.MINA_GOOGLE_SERVICES
          ?? path.join(ROOT_DIR, 'env', 'google-services.json');
        const googleServices = JSON.parse(await readFile(googleServicesPath, 'utf8'));
        chatFirestore = await createFirestoreRelayAdapter({
          config: firebaseConfigFromGoogleServices(googleServices),
        });
      } catch (error) {
        void activityJournal?.append('chat_relay_indisponible', {
          reason: String(error?.message ?? error).slice(0, 200),
        });
      }

      chatChannel = createChatChannel({
        masterKey: () => chatMasterKey,
        identity: chatIdentity,
        firestore: chatFirestore,
        publicKeyFromSpki: (spki) => createPublicKey({
          key: Buffer.from(spki, 'base64'), format: 'der', type: 'spki',
        }),
        store: createVersionedJsonStore({
          filename: path.join(app.getPath('userData'), 'chat-devices.json'),
          schemaVersion: 1,
          readFile,
          writeFile,
          rename,
        }),
        // Ledger durable : après un redémarrage du PC, un message redélivré n'obtient pas une
        // SECONDE réponse, différente de la première.
        ledgerStore: createVersionedJsonStore({
          filename: path.join(app.getPath('userData'), 'chat-ledger.json'),
          schemaVersion: 1,
          readFile,
          writeFile,
          rename,
        }),
        respond: createChatResponder({
          generate: async (input) => (await telegramTextGenerator()).generate(input),
          memory: memoryController,
          logger: { append: (entry) => void activityJournal?.append(entry.event ?? 'chat_app', entry) },
        }),
        port: Number(process.env.MINA_CHAT_PORT ?? 8771),
        host: process.env.MINA_CHAT_HOST ?? '0.0.0.0',
        logger: { append: (entry) => void activityJournal?.append(entry.event ?? 'chat_app', entry) },
      });
      await chatChannel.load();
      const listening = await chatChannel.start();
      void activityJournal?.append('chat_app_canal', {
        listening: Boolean(listening),
        port: listening?.port ?? null,
        error: chatChannel.status().lastError,
      });
    } else {
      void activityJournal?.append('chat_app_canal', { listening: false, error: 'coffre_verrouille' });
    }
  } catch (error) {
    const message = String(error?.message ?? error).slice(0, 300);
    technicalLog.record({ severity: 'warning', scope: 'chat', code: 'chat_app_canal_indisponible', message });
    void activityJournal?.append('chat_app_canal', { listening: false, error: message });
  }
  const skillsRoot = path.join(app.getPath('userData'), 'skills');
  const quarantineRoot = path.join(app.getPath('userData'), 'skill-quarantine');
  const sandboxRoot = storageRoots.sandboxRoot;
  const sandboxRuntimeRoot = storageRoots.sandboxRuntimeRoot;
  await Promise.all([mkdir(skillsRoot, { recursive: true }), mkdir(quarantineRoot, { recursive: true }), mkdir(sandboxRoot, { recursive: true })]);
  const skillRegistry = createSkillRegistry({ root: skillsRoot });
  const bundledSkillRegistry = createSkillRegistry({ root: path.join(ROOT_DIR, 'skills-reference') });
  const compositeSkills = createCompositeSkillRuntime({
    primaryRegistry: skillRegistry,
    primaryLoader: createSkillLoader({ root: skillsRoot }),
    bundledRegistry: bundledSkillRegistry,
    bundledLoader: createSkillLoader({ root: path.join(ROOT_DIR, 'skills-reference') }),
  });
  await compositeSkills.refresh();
  skillSessions = createSkillSessionManager();
  skillRouter = createSkillRouter({
    registry: compositeSkills.registry,
    loader: compositeSkills.loader,
    budgetGuard,
    sessions: skillSessions,
    threshold: 0.6,
  });
  const skillInstaller = createSkillInstaller({
    quarantineRoot,
    skillsRoot,
    confirmLocal: confirmDigestAction,
  });
  const runtimeManifest = createRuntimeManifest({
    manifestPath: path.join(sandboxRuntimeRoot, 'runtime-manifest.json'),
    runtimeRoot: sandboxRuntimeRoot,
  });
  const sandboxLauncher = createWindowsSandboxLauncher();
  const sandboxBackend = createWindowsSandboxBackend({
    workspaceRoot: sandboxRoot,
    runtimeManifest,
    launcher: sandboxLauncher.launch,
    writeWsb: async ({ jobId, xml }) => {
      const directory = path.join(sandboxRoot, 'configs');
      await mkdir(directory, { recursive: true });
      const filename = path.join(directory, `${jobId}.wsb`);
      await writeFile(filename, xml, { flag: 'wx', encoding: 'utf8' });
      return filename;
    },
  });
  const sandboxRunner = createSandboxRunner({
    backend: sandboxBackend,
    workspaceManager: createJobWorkspaceManager({
      root: path.join(sandboxRoot, 'jobs'),
      bootstrapPath: sandboxRuntimeRoot,
    }),
    launcher: sandboxLauncher,
    importRoot: path.join(app.getPath('documents'), 'Mina Vision', 'Sandbox'),
    confirmLocal: confirmDigestAction,
  });
  capabilityProbes = {
    listSkills: async () => {
      await skillRegistry.scan().catch(() => {});
      return skillRegistry.list().map((entry) => entry.name ?? entry.slug ?? String(entry));
    },
    listBundledSkills: async () => {
      await bundledSkillRegistry.scan().catch(() => {});
      return bundledSkillRegistry.list().map((entry) => entry.name ?? entry.slug ?? String(entry));
    },
    sandboxDetect: () => sandboxBackend.detect(),
  };
  sandboxManager = createSandboxUiManager({
    backend: sandboxBackend,
    revalidateProposal: async (proposal) => proposal,
    confirmLocal: confirmDigestAction,
    runner: sandboxRunner,
  });
  skillsSandboxController = createSkillsSandboxController({
    loadInstructions: () => loadMinaInstructions({ filename: path.join(ROOT_DIR, 'MINA.md') }),
    skillRegistry,
    bundledSkillRegistry,
    skillInstaller,
    selectSkillPackage: async () => {
      const selected = await dialog.showOpenDialog(mainWindow, {
        title: 'Choisir un skill Mina Vision auditable',
        properties: ['openFile'],
        filters: [{ name: 'Skill Mina Vision', extensions: ['zip'] }],
      });
      return selected.canceled ? null : (selected.filePaths[0] ?? null);
    },
    sandboxManager,
  });
  // Mail domain: infrastructure wired and reachable via IPC, but no adapter is constructed until
  // an account is actually configured (none exist in this environment yet). Mode 3 by default per spec.
  // Smart-home domain: empty registry/router until Home Assistant/MQTT/Google Home bindings exist.
  // Camera domain: streaming is fully functional; biometric enrollment requires local ONNX face
  // models that are not downloaded in this environment (`models.install`, explicit action only),
  // so the embedder fails closed with a clear error rather than ever faking a recognition result.
  // All three are optional at startup: a failure here (e.g. keyring not yet initialized on first
  // run) must never block local core startup, matching the v3 integration plan's degraded-domain rule.
  try {
    const mailMasterKey = await keyring.open();
    mailDatabase = openMemoryDatabase({
      filename: path.join(app.getPath('userData'), 'mina-mail.sqlite'),
      nativeBinding,
      securePermissions: () => {},
    });
    applyMailMigrations(mailDatabase);
    const mailRepository = createMailRepository({ db: mailDatabase, encryptionKey: mailMasterKey });
    const mailAccountStore = createMailAccountStore({ keyring });
    const mailPolicy = createMailPolicy({ defaultMode: 3 });
    const mailAccounts = await mailAccountStore.listStatus();
    const googleRuntime = await createGoogleRuntimeAdapters({
      accounts: mailAccounts,
      // Keyring first (set by `npm run connect:google`), then the env/ file directly — so a
      // client_secret_*.json dropped into env/ works without a separate manual keyring import.
      // createGoogleRuntimeAdapters JSON.parses this, so the file object is re-serialized to match
      // the keyring's stored JSON-string shape. (The per-account OAuth refresh token still comes
      // from the keyring via getCredentials — the client config alone never connects an account.)
      getClientConfig: async () => {
        const stored = await keyring.getSecret('google/oauth/client-config');
        if (stored) return stored;
        const fromFile = loadGoogleClientConfigFromEnvDir(path.join(ROOT_DIR, 'env'), { readdirSync, readFileSync });
        return fromFile ? JSON.stringify(fromFile) : null;
      },
      getCredentials: (accountId) => mailAccountStore.getCredentials(accountId),
    });
    const mailAdapters = googleRuntime.mailAdapters;
    mailOperationalAccountIds = [...googleRuntime.operationalAccountIds];
    mailOperational = mailOperationalAccountIds.length > 0;
    const mailSyncService = createMailSyncService({ repository: mailRepository, adapters: mailAdapters });
    const mailService = createMailService({ policy: mailPolicy, adapters: mailAdapters, confirmLocal: confirmDigestAction });
    mailController = createMailController({ mailAccountStore, mailSyncService, mailService, searchMessages: async () => [] });
    mailAccountStoreRef = mailAccountStore;
    mailSyncServiceRef = mailSyncService;
    mailPolicyRef = mailPolicy;
    if (googleRuntime.googlePersonalAdapter) {
      const personalHub = createPersonalDataHub({ adapters: [googleRuntime.googlePersonalAdapter] });
      const confirmationService = { confirm: async ({ reason }) => confirmSensitiveAction({ reason, action: { name: 'personal.write' } }) };
      const simpleActionVerifier = { verify: async ({ receipt }) => ({ confirmed: Boolean(receipt) }) };

      googleTaskService = createTaskService({
        repository: createTaskRepository({
          repository: createJsonRepository({ filename: path.join(app.getPath('userData'), 'mina-personal-tasks.sqlite'), table: 'tasks', nativeBinding }),
        }),
        hub: personalHub,
        capabilityBroker: { authorize: async () => ({ decision: 'allow', reason: 'confirmed_local_voice' }) },
        clock: Date.now,
      });
      googleTasksOperational = true;

      personalCalendarDatabase = new BetterSqlite3(path.join(app.getPath('userData'), 'mina-personal-calendar.sqlite'), { nativeBinding });
      applyPersonalCalendarMigrations(personalCalendarDatabase);
      googleCalendarService = createCalendarService({
        hub: personalHub,
        repository: createCalendarRepository({ db: personalCalendarDatabase, clock: Date.now }),
        capabilityBroker: { authorize: async () => ({ decision: 'allow', reason: 'confirmed_local_voice' }) },
        actionVerifier: simpleActionVerifier,
        confirmationService,
        clock: Date.now,
      });

      googleContactService = createContactService({
        repository: createContactRepository({
          repository: createJsonRepository({ filename: path.join(app.getPath('userData'), 'mina-personal-contacts.sqlite'), table: 'contacts', nativeBinding }),
        }),
        hub: personalHub,
        confirmationService,
        clock: Date.now,
      });
    }
    if (mailAccounts.length > 0 && !mailOperational) {
      technicalLog.record({ severity: 'warning', scope: 'domain:google', code: googleRuntime.reason, message: googleRuntime.reason });
    }
  } catch (error) {
    send('mina:event', { type: 'domain_degraded', domain: 'mail', reason: String(error?.message ?? error).slice(0, 200) });
  }

  try {
    const homeRegistry = createSmartHomeRegistry({ devices: [] });
    const homePolicy = createSmartHomePolicy({ telegramLowRiskEnabled: false });
    const homeRouter = createSmartHomeRouter({ connectors: [] });
    const homeService = createSmartHomeService({ registry: homeRegistry, policy: homePolicy, router: homeRouter });
    homeController = createHomeController({
      registry: homeRegistry, service: homeService, connectors: {},
      audit: (event) => send('mina:event', { type: 'home_audit', ...event }),
    });
    homeRegistryRef = homeRegistry;
    homeServiceRef = homeService;
  } catch (error) {
    send('mina:event', { type: 'domain_degraded', domain: 'home', reason: String(error?.message ?? error).slice(0, 200) });
  }

  try {
    const faceProfileStore = createFaceProfileStore({ keyring });
    const faceRecognizer = createFaceRecognizer({
      embedder: { embed: async () => { throw new Error('face_embedding_pipeline_not_implemented'); } },
      profileStore: faceProfileStore,
      confirmLocal: confirmDigestAction,
    });
    const bridge = getPhoneBridge();
    cameraRuntime = createSharedCameraRuntime({
      phoneBridge: bridge,
      onFrame: (frame) => send('mina:camera-frame', {
        sessionId: frame.sessionId,
        sequence: frame.sequence,
        capturedAtMs: frame.capturedAtMs,
        lens: frame.lens,
        rotation: frame.rotation,
        width: frame.width,
        height: frame.height,
        mimeType: frame.mimeType,
        imageBase64: frame.jpeg.toString('base64'),
      }),
      onStatus: (status) => send('mina:camera-status', status),
    });
    cameraController = createCameraController({
      phoneBridge: bridge,
      cameraClient: cameraRuntime,
      faceRecognizer,
      profileStore: faceProfileStore,
    });
  } catch (error) {
    send('mina:event', { type: 'domain_degraded', domain: 'camera', reason: String(error?.message ?? error).slice(0, 200) });
  }

  // ===== Réconciliation Tasks 8-16 : composition des domaines restants + catalogue de vérité =====
  runtimeCapabilityCatalog = createRuntimeCapabilityCatalog();
  const reportCapability = (id, status, reason = null, evidence = []) => {
    try {
      runtimeCapabilityCatalog.report({ id, status, reason, evidence });
    } catch { /* le catalogue ne casse jamais le boot */ }
  };

  // Task 11 — domaine personnel : briefing du jour + routines + graphe personnel (composition
  // réelle ; les services Google restent optionnels — sections absentes si non connectés, honnête).
  try {
    const routineRegistry = createRoutineRegistry({
      repository: createJsonRepository({ filename: path.join(app.getPath('userData'), 'mina-personal-routines.sqlite'), table: 'routines', nativeBinding }),
      clock: Date.now,
    });
    const dailyBriefingService = createDailyBriefingService({
      calendarService: googleCalendarService,
      routineRegistry,
      clock: Date.now,
    });
    personalGraphDatabase = new BetterSqlite3(path.join(app.getPath('userData'), 'mina-personal-graph.sqlite'), { nativeBinding });
    applyPersonalGraphMigrations(personalGraphDatabase);
    const graphRepository = createGraphRepository({ db: personalGraphDatabase, clock: Date.now });
    const personalGraph = createPersonalGraph({ repository: graphRepository, clock: Date.now });
    personalControllers = {
      today: createTodayController({ dailyBriefingService, calendarService: googleCalendarService, routineRegistry }),
      graph: createGraphController({
        personalGraph,
        entityResolver: createEntityResolver({ repository: graphRepository }),
        contactService: googleContactService,
      }),
    };
    reportCapability('personal', googleCalendarService ? 'available' : 'degraded', googleCalendarService ? null : 'google_personnel_non_connecte');
  } catch (error) {
    reportCapability('personal', 'unavailable', String(error?.message ?? error).slice(0, 200));
    send('mina:event', { type: 'domain_degraded', domain: 'personal', reason: String(error?.message ?? error).slice(0, 200) });
  }

  // Task 12 — documents : réception en quarantaine + impression réelle ; les services sans
  // implémentation runtime (conversion sandbox, formulaires, téléchargement) restent absents.
  try {
    const documentIntake = createDocumentIntake({
      quarantineStore: createDocumentQuarantineStore({
        filesystem: { writeFile, readFile, mkdir, rm },
        repository: createJsonRepository({ filename: path.join(app.getPath('userData'), 'mina-document-quarantine.sqlite'), table: 'documents', nativeBinding }),
        quarantineDir: path.join(app.getPath('userData'), 'document-quarantine'),
      }),
      filesystem: { readFile },
      realpathProvider: { resolve: (target) => realpath(target) },
      clock: Date.now,
    });
    documentController = {
      ...createDocumentController({
        intake: documentIntake,
        printService,
        printerRegistry,
      }),
      // Les canaux mina:printing:* restent aux handlers historiques de main.mjs — ce sont eux
      // qui portent la confirmation locale (voir document-ipc.mjs).
      registerPrinting: false,
    };
    reportCapability('documents', 'available');
  } catch (error) {
    reportCapability('documents', 'unavailable', String(error?.message ?? error).slice(0, 200));
    send('mina:event', { type: 'domain_degraded', domain: 'documents', reason: String(error?.message ?? error).slice(0, 200) });
  }

  // Task 13 — personnalité : service réel scellé par le coffre (dégradé tant que le coffre
  // n'est pas ouvrable). Aucune élévation : proposer ne mutera jamais sans confirmation locale.
  try {
    const personalityService = createPersonalityService({
      keyring,
      configRepository: createJsonRepository({ filename: path.join(app.getPath('userData'), 'mina-personality.sqlite'), table: 'personality', nativeBinding }),
      clock: Date.now,
    });
    personalityController = createPersonalityController({ personalityService });
    reportCapability('personality', 'available');
  } catch (error) {
    reportCapability('personality', 'unavailable', String(error?.message ?? error).slice(0, 200));
  }

  // Tasks 10/13/14/15/16 — domaines dont une dépendance runtime N'EXISTE PAS dans le code :
  // publiés indisponibles avec la dépendance manquante NOMMÉE — jamais composés sur des
  // simulacres, jamais masqués. (Task 14 home et Task 15 biométrie : composés plus haut en
  // dégradé réel ; Task 16 backup : état de configuration réel.)
  reportCapability('automation', 'unavailable', 'dependances_absentes:domain_registry.invoke,budget_estimator,disclosure_classifier');
  reportCapability('recovery', 'unavailable', 'dependance_absente:automation_runner');
  reportCapability('evaluation', 'unavailable', 'dependance_absente:model_router.route');
  reportCapability('emergency', 'unavailable', 'dependances_absentes:network_policy,device_guard');
  reportCapability('approvals', 'unavailable', 'dependance_absente:state_observer (les approbations distantes Telegram restent servies par la passerelle Android)');
  reportCapability('connectors', 'unavailable', 'dependances_absentes:zip_inspector,dependency_scanner');
  reportCapability('mail', mailOperational ? 'available' : (mailController ? 'degraded' : 'unavailable'), mailOperational ? null : 'aucun_compte_operationnel');
  reportCapability('home', 'degraded', 'aucun_connecteur_configure');
  reportCapability('camera', cameraController ? 'degraded' : 'unavailable', 'flux_reel_disponible_biometrie_non_implementee');
  reportCapability('biometrics.face', 'unavailable', 'face_embedding_pipeline_not_implemented');
  reportCapability('backup', process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_STORAGE_BUCKET ? 'degraded' : 'unavailable', process.env.FIREBASE_PROJECT_ID ? 'configure_non_verifie' : 'firebase_non_configure');
  reportCapability('computer_use.browser', 'available');
  reportCapability('computer_use.desktop', 'available');
  reportCapability('computer_use.android', 'available');
  reportCapability('code', 'available');
  reportCapability('voice', 'available');
  reportCapability('sandbox', 'degraded', 'sonde_a_la_demande_via_capabilities');
  reportCapability('memory', memoryController?.status?.()?.locked === false ? 'available' : 'degraded', memoryController?.status?.()?.locked === false ? null : 'coffre_verrouille');

  minaCore = createMinaRuntime({
    sessionManager,
    claimLedger,
    evidenceProvider: (request) => memoryController.missionEvidence(request),
    cancellers: [
      () => sandboxManager.cancelAll(),
      async () => {
        if (!mailController) return;
        const statuses = await mailController.listAccounts().catch(() => []);
        await Promise.all(statuses.map((status) => mailController.pauseAccount(status.accountId).catch(() => {})));
      },
    ],
  });
  await minaCore.start();
  registerIpc();
  const adbWifiStatePath = path.join(app.getPath('userData'), 'mina-adb-wifi.json');
  const adbWifiEndpointStore = createAdbWifiEndpointStore({
    filename: adbWifiStatePath,
    readText: (filename) => readFile(filename, 'utf8'),
    writeAtomic: async (filename, content) => {
      const temporary = `${filename}.${process.pid}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
        await rename(temporary, filename);
      } finally {
        await rm(temporary, { force: true }).catch(() => {});
      }
    },
  });
  adbWifiKeeper = createAdbWifiKeeper({
    bridge: getPhoneBridge(),
    loadEndpoint: adbWifiEndpointStore.loadEndpoint,
    saveEndpoint: adbWifiEndpointStore.saveEndpoint,
    onStatus: (status) => {
      send('mina:event', { type: 'adb_wifi_status', ...status });
      if (!status.connected) technicalLog.record({
        severity: 'warning', scope: 'phone:adb-wifi', code: 'adb_wifi_reconnect_pending', message: status.reason,
      });
    },
  });
  void adbWifiKeeper.start();
  const samsungSerial = String(process.env.MINA_SAMSUNG_ADB_SERIAL ?? '').trim();
  if (samsungSerial) {
    // Le Samsung en mode tcpip ne s'annonce pas en mDNS (prouvé 2026-07-22) : la dernière
    // endpoint qui a passé la vérification d'identité est mémorisée et resservie en fallback.
    const samsungEndpointFile = path.join(app.getPath('userData'), 'samsung-adb-wifi.json');
    // Amélioration C : état versionné fail-closed — une version inconnue part en quarantaine
    // .perdu-<date>, jamais interprétée ni écrasée. Le fichier legacy {version:1,endpoint} migre.
    const samsungEndpointStore = createVersionedJsonStore({
      filename: samsungEndpointFile,
      schemaVersion: 1,
      readFile,
      writeFile,
      rename,
      migrateLegacy: (raw) => (typeof raw?.endpoint === 'string' ? { endpoint: raw.endpoint } : null),
    });
    samsungAdbWifiKeeper = createAdbMdnsPeerKeeper({
      adbPath: currentConfig().adbPath,
      serial: samsungSerial,
      role: 'samsung',
      recallEndpoint: async () => {
        const { data } = await samsungEndpointStore.load({ defaults: null });
        return typeof data?.endpoint === 'string' ? data.endpoint : null;
      },
      rememberEndpoint: async (endpoint) => {
        await samsungEndpointStore.save({ endpoint });
      },
      onStatus: (status) => {
        send('mina:event', { type: 'adb_wifi_status', ...status });
        if (!status.connected) technicalLog.record({
          severity: 'warning', scope: 'samsung:adb-wifi', code: 'samsung_adb_wifi_reconnect_pending', message: status.reason,
        });
      },
    });
    samsungAdbWifiKeeper.start();
  }
  startPhoneMessageSyncLoop();
  // Inert unless HTTPSMS is configured in .env; never blocks startup on failure.
  void startHttpsmsWebhookServer().catch((error) => technicalLog.record({
    severity: 'error', scope: 'httpsms:webhook', code: 'httpsms_webhook_start_failed',
    message: String(error?.message ?? error).slice(0, 200),
  }));
  globalShortcut.register('CommandOrControl+Alt+Escape', () => { void stopEverything(); });
  await createWindow();
});

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  localVoiceInstance?.close(); // le worker Kokoro ne doit jamais survivre à l'app (leçon des zombies)
  deepgramFallback?.close();
  void selfModel?.flush();
});
app.on('before-quit', (event) => {
  if (shutdownStarted) return;
  shutdownStarted = true;
  event.preventDefault();
  if (phoneMessageSyncTimer) clearInterval(phoneMessageSyncTimer);
  phoneMessageSyncTimer = null;
  void httpsmsWebhookServer?.stop();
  adbWifiKeeper?.stop();
  samsungAdbWifiKeeper?.stop();
  voice?.close();
  voice = null;
  void (async () => {
    await minaCore?.shutdown({ timeoutMs: 2_000 });
    if (runtime) await runtime.close();
    await chatChannel?.stop();
    memoryController?.lock();
    if (usageDatabase?.open) usageDatabase.close();
    if (mailDatabase?.open) mailDatabase.close();
    messageDeliveryLedger?.close();
    printerRepository?.close();
    if (personalCalendarDatabase?.open) personalCalendarDatabase.close();
    if (browserExecutor) await browserExecutor.close();
  })().finally(() => app.exit(0));
});
