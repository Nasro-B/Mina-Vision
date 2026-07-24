const { contextBridge, ipcRenderer } = require('electron');

// Inlined here (not required from a separate file) because sandboxed preload scripts (Electron
// 20+, sandbox: true) run with a polyfilled require() that cannot resolve local CommonJS modules
// — only contextBridge.exposeInMainWorld reaches the renderer, so this stays a single self-
// contained file. createPreloadApi is still exported for tests/preload-api.test.mjs to exercise
// directly with a fake ipcRenderer, without ever touching contextBridge.
function createPreloadApi(ipcRenderer) {
  const subscriptions = new Map();
  const subscribe = (channel, callback) => {
    if (typeof callback !== 'function') throw new TypeError('Callback requis.');
    const wrapped = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, wrapped);
    const token = Symbol(channel);
    subscriptions.set(token, [channel, wrapped]);
    return () => {
      const current = subscriptions.get(token);
      if (!current) return;
      ipcRenderer.removeListener(current[0], current[1]);
      subscriptions.delete(token);
    };
  };

  return Object.freeze({
    status: () => ipcRenderer.invoke('mina:status'),
    start: (request) => ipcRenderer.invoke('mina:start', request),
    dental: (request) => ipcRenderer.invoke('mina:dental', request),
    stop: () => ipcRenderer.invoke('mina:stop'),
    detectPhone: () => ipcRenderer.invoke('mina:phone-detect'),
    startPhoneCamera: () => ipcRenderer.invoke('mina:phone-camera'),
    stopPhoneCamera: () => ipcRenderer.invoke('mina:phone-camera-stop'),
    sendSmsConfirmed: (request) => ipcRenderer.invoke('mina:sms-send-confirmed', request),
    syncPhoneMessages: () => ipcRenderer.invoke('mina:phone-sync-messages'),
    settingsSchema: () => ipcRenderer.invoke('mina:settings:get-schema'),
    settingsState: () => ipcRenderer.invoke('mina:settings:get'),
    updateSettings: (request) => ipcRenderer.invoke('mina:settings:update', request),
    setProviderSecret: (request) => ipcRenderer.invoke('mina:settings:set-secret', request),
    revokeProviderSecret: (request) => ipcRenderer.invoke('mina:settings:revoke-secret', request),
    testProvider: (request) => ipcRenderer.invoke('mina:settings:test-provider', request),
    queryAnalytics: (request) => ipcRenderer.invoke('mina:analytics:query', request),
    analyticsBudgets: (request) => ipcRenderer.invoke('mina:analytics:budgets', request),
    exportAnalytics: (request) => ipcRenderer.invoke('mina:analytics:export', request),
    startVoice: () => ipcRenderer.invoke('mina:voice-start'),
    stopVoice: () => ipcRenderer.invoke('mina:voice-stop'),
    sessionState: () => ipcRenderer.invoke('mina:session-state'),
    claims: () => ipcRenderer.invoke('mina:claims'),
    groundingStatus: () => ipcRenderer.invoke('mina:grounding-status'),
    memoryStatus: () => ipcRenderer.invoke('memory.status'),
    initializeMemory: () => ipcRenderer.invoke('memory.initialize'),
    unlockMemory: (request) => ipcRenderer.invoke('memory.unlock', request),
    probeMemory: () => ipcRenderer.invoke('memory.probe'),
    reinitializeMemoryFresh: () => ipcRenderer.invoke('memory.reinitializeFresh'),
    lockMemory: () => ipcRenderer.invoke('memory.lock'),
    searchMemory: (request) => ipcRenderer.invoke('memory.search', request),
    proposeForget: (request) => ipcRenderer.invoke('memory.proposeForget', request),
    readFile: (request) => ipcRenderer.invoke('research.readFile', request),
    readWeb: (request) => ipcRenderer.invoke('research.readWeb', request),
    skillsSandboxStatus: () => ipcRenderer.invoke('mina:skills-sandbox:status'),
    chooseAndStageSkill: () => ipcRenderer.invoke('mina:skills:choose-stage'),
    installSkill: (request) => ipcRenderer.invoke('mina:skills:install', request),
    executeSandbox: (request) => ipcRenderer.invoke('mina:sandbox:execute', request),
    cancelSandbox: (request) => ipcRenderer.invoke('mina:sandbox:cancel', request),
    importSandboxArtifact: (request) => ipcRenderer.invoke('mina:sandbox:import-artifact', request),
    listMailAccounts: () => ipcRenderer.invoke('mina:mail:list-accounts'),
    pauseMailAccount: (request) => ipcRenderer.invoke('mina:mail:pause', request),
    resumeMailAccount: (request) => ipcRenderer.invoke('mina:mail:resume', request),
    searchMail: (request) => ipcRenderer.invoke('mina:mail:search', request),
    proposeMailDraft: (request) => ipcRenderer.invoke('mina:mail:propose-draft', request),
    proposeMailSend: (request) => ipcRenderer.invoke('mina:mail:propose-send', request),
    commitMailProposal: (request) => ipcRenderer.invoke('mina:mail:commit', request),
    homeConnectorHealth: () => ipcRenderer.invoke('mina:home:connector-health'),
    requestHomePermission: (request) => ipcRenderer.invoke('mina:home:request-permission', request),
    discoverHomeDevices: (request) => ipcRenderer.invoke('mina:home:discover', request),
    listHomeDevices: () => ipcRenderer.invoke('mina:home:list'),
    resolveHomeTarget: (request) => ipcRenderer.invoke('mina:home:resolve', request),
    editHomeDevice: (request) => ipcRenderer.invoke('mina:home:edit-device', request),
    executeHomeCommand: (request) => ipcRenderer.invoke('mina:home:execute', request),
    homeAuditHistory: (request) => ipcRenderer.invoke('mina:home:audit-history', request),
    cameraStatus: () => ipcRenderer.invoke('mina:camera:status'),
    startCameraStream: (request) => ipcRenderer.invoke('mina:camera:start', request),
    stopCameraStream: () => ipcRenderer.invoke('mina:camera:stop'),
    switchCameraLens: (request) => ipcRenderer.invoke('mina:camera:switch-lens', request),
    nextCameraPreviewFrame: () => ipcRenderer.invoke('mina:camera:preview-frame'),
    enrollFace: (request) => ipcRenderer.invoke('mina:camera:enroll', request),
    deleteFaceProfile: (request) => ipcRenderer.invoke('mina:camera:delete-profile', request),
    listAutomationDefinitions: () => ipcRenderer.invoke('mina:automation:list-definitions'),
    listRecoveryCases: (request) => ipcRenderer.invoke('mina:recovery:list-cases', request),
    healthSnapshot: () => ipcRenderer.invoke('mina:health:snapshot'),
    getDailyBriefing: (request) => ipcRenderer.invoke('mina:personal:briefing', request),
    getEmergencyStatus: () => ipcRenderer.invoke('mina:emergency:status'),
    // Read-only: publisher approval, connector activation and personality patch confirmation are
    // never exposed to the renderer (they stay main-process/local, per the plan's Global Constraint).
    listConnectors: () => ipcRenderer.invoke('mina:connectors:list'),
    getPersonalityProfile: () => ipcRenderer.invoke('mina:personality:get'),
    openHelp: () => ipcRenderer.invoke('mina:help:open'),
    closeBrowser: () => ipcRenderer.invoke('mina:browser:close'),
    connectGoogleBrowser: () => ipcRenderer.invoke('mina:browser:google-login'),
    searchYouTube: (request) => ipcRenderer.invoke('mina:youtube-search', request),
    webAnswer: (request) => ipcRenderer.invoke('mina:web-answer', request),
    localTts: (request) => ipcRenderer.invoke('mina:local-tts', request),
    readJournal: (request) => ipcRenderer.invoke('mina:journal-read', request),
    codeStatus: () => ipcRenderer.invoke('mina:code:status'),
    codeIndex: () => ipcRenderer.invoke('mina:code:index'),
    codeSearch: (request) => ipcRenderer.invoke('mina:code:search', request),
    codeImpact: (request) => ipcRenderer.invoke('mina:code:impact', request),
    codeGitStatus: () => ipcRenderer.invoke('mina:code:git-status'),
    codeGitLog: (request) => ipcRenderer.invoke('mina:code:git-log', request),
    codeGitDiff: (request) => ipcRenderer.invoke('mina:code:git-diff', request),
    codeReview: (request) => ipcRenderer.invoke('mina:code:review', request),
    codeTestsRun: (request) => ipcRenderer.invoke('mina:code:tests-run', request),
    codePlans: () => ipcRenderer.invoke('mina:code:plans'),
    sendVoiceAudio: (arrayBuffer) => {
      if (!(arrayBuffer instanceof ArrayBuffer) || arrayBuffer.byteLength > 1_000_000) return;
      ipcRenderer.send('mina:voice-input', new Uint8Array(arrayBuffer));
    },
    onEvent: (callback) => subscribe('mina:event', callback),
    onVoiceWake: (callback) => subscribe('mina:voice-wake', callback),
    // C3 — décodage audio pour la transcription locale : le main envoie du m4a (base64), le
    // renderer répond du PCM 16 kHz mono (l'AudioContext de Chromium sait décoder l'AAC, Node non).
    onDecodeAudioRequest: (callback) => subscribe('mina:decode-audio:request', callback),
    replyDecodedAudio: (payload) => ipcRenderer.send('mina:decode-audio:reply', payload),
    onVoiceCommand: (callback) => subscribe('mina:voice-command', callback),
    onVoiceDialogue: (callback) => subscribe('mina:voice-dialogue', callback),
    sayVoice: (text) => ipcRenderer.invoke('mina:voice-say', String(text ?? '').slice(0, 1_200)),
    guideMission: (text) => ipcRenderer.invoke('mina:mission-guide', String(text ?? '').slice(0, 4_000)),
    capabilities: () => ipcRenderer.invoke('mina:capabilities'),
    capabilityCatalog: () => ipcRenderer.invoke('mina:capability-catalog'),
    // Catalogue de vérité runtime (Task 8) : état réel de chaque domaine avec raison.
    capabilitiesList: () => ipcRenderer.invoke('mina:capabilities:list'),
    capabilityCatalog: () => ipcRenderer.invoke('mina:capability-catalog'),
    // Démarrage automatique avec Windows.
    startupStatus: () => ipcRenderer.invoke('mina:startup:status'),
    setStartup: (enabled) => ipcRenderer.invoke('mina:startup:set', { enabled }),
    // Canal application Mina (téléphone appairé) : aucun contenu de conversation ne passe ici,
    // uniquement l'état du canal et les décisions d'appairage.
    chatStatus: () => ipcRenderer.invoke('mina:chat:status'),
    chatOpenPairing: () => ipcRenderer.invoke('mina:chat:openPairing'),
    chatClosePairing: () => ipcRenderer.invoke('mina:chat:closePairing'),
    chatRevokeDevice: (deviceId) => ipcRenderer.invoke('mina:chat:revoke', { deviceId }),
    chatSendFile: (deviceId) => ipcRenderer.invoke('mina:chat:sendFile', { deviceId }),
    callDial: (deviceId, number) => ipcRenderer.invoke('mina:call:dial', { deviceId, number }),
    // Domaines composés par la réconciliation (T11-T13).
    personalBriefing: (payload) => ipcRenderer.invoke('mina:personal:briefing', payload),
    personalTasks: () => ipcRenderer.invoke('mina:personal:tasks'),
    routinesList: () => ipcRenderer.invoke('mina:routines:list'),
    graphSubgraph: (payload) => ipcRenderer.invoke('mina:graph:subgraph', payload),
    graphListContacts: () => ipcRenderer.invoke('mina:graph:list-contacts'),
    documentIntake: (payload) => ipcRenderer.invoke('mina:documents:intake', payload),
    documentGet: (payload) => ipcRenderer.invoke('mina:documents:get', payload),
    personalityGet: () => ipcRenderer.invoke('mina:personality:get'),
    smsPolicyStatus: () => ipcRenderer.invoke('mina:sms-policy-status'),
    smsStatus: () => ipcRenderer.invoke('mina:sms-status'),
    smsPolicyRevoke: () => ipcRenderer.invoke('mina:sms-policy-revoke'),
    smsPolicyReactivate: () => ipcRenderer.invoke('mina:sms-policy-reactivate'),
    discoverPrinters: () => ipcRenderer.invoke('mina:printing:discover'),
    approvePrinter: (printerId) => ipcRenderer.invoke('mina:printing:approve', { printerId }),
    printFile: (request) => ipcRenderer.invoke('mina:printing:print-file', request),
    listTechnicalLogs: () => ipcRenderer.invoke('mina:technical-log:list'),
    clearTechnicalLogs: () => ipcRenderer.invoke('mina:technical-log:clear'),
    reportTechnicalError: (request) => ipcRenderer.invoke('mina:technical-log:record', request),
    onTechnicalLog: (callback) => subscribe('mina:technical-log', callback),
    listTechnicalLogAggregate: () => ipcRenderer.invoke('mina:technical-log:aggregate'),
    onTechnicalLogAggregate: (callback) => subscribe('mina:technical-log-aggregate', callback),
    onVoiceIntent: (callback) => subscribe('mina:voice-intent', callback),
    onVoiceTranscript: (callback) => subscribe('mina:voice-transcript', callback),
    onVoiceAudio: (callback) => subscribe('mina:voice-audio', callback),
    onVoiceInterrupted: (callback) => subscribe('mina:voice-interrupted', callback),
    onVoiceStopSpeech: (callback) => subscribe('mina:voice-stop-speech', callback),
    onCameraFrame: (callback) => subscribe('mina:camera-frame', callback),
    onCameraStatus: (callback) => subscribe('mina:camera-status', callback),
    onSandboxEvent: (callback) => subscribe('mina:sandbox:event', callback),
  });
}

if (contextBridge && typeof contextBridge.exposeInMainWorld === 'function') {
  contextBridge.exposeInMainWorld('mina', createPreloadApi(ipcRenderer));
}

module.exports = { createPreloadApi };
