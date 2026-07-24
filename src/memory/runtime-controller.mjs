import { createHash } from 'node:crypto';
import { createResearchEvidenceCompactor } from './research-evidence-compactor.mjs';

const MAX_RECALL_ITEMS = 20;
const MAX_RESEARCH_EVIDENCE = 50;
const REMOTE_ID_PATTERN = /^[A-Za-z0-9+/=_:-]{1,160}$/u;
const DEVICE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/u;

function memoryEvidence(item) {
  const capturedAt = new Date(item.date).toISOString();
  const digest = createHash('sha256').update(`${item.date}\0${item.content}`).digest('hex');
  return Object.freeze({
    sourceId: `memory-${digest.slice(0, 20)}`,
    locator: `memory://owner/${encodeURIComponent(capturedAt)}`,
    capturedAt,
    contentDigest: `sha256:${digest}`,
    freshnessClass: 'historical',
    extract: String(item.content).slice(0, 4_000),
    method: 'document',
  });
}

function publicItem(item, revealSensitive) {
  const masked = item.content === '••••'
    || (!revealSensitive && ['sensitive', 'secret', 'otp'].includes(item.classification));
  return Object.freeze({
    content: masked ? '••••' : String(item.content).slice(0, 4_000),
    score: Number(item.score) || 0,
    provenance: structuredClone(item.provenance ?? {}),
    date: item.date,
    classification: item.classification ?? 'normal',
    retention: item.retention ?? 'indefinite',
    masked,
  });
}

export function createMemoryRuntimeController({
  keyring,
  buildServices,
  confirmLocal = async () => false,
  researchEvidenceCompactor = createResearchEvidenceCompactor({ maxItems: MAX_RESEARCH_EVIDENCE }),
  // Résilience à l'indéchiffrabilité TRANSITOIRE du wrap DPAPI (voir unlock). 4 essais × 250 ms.
  autoUnlockAttempts = 4,
  autoUnlockDelayMs = 250,
  sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
} = {}) {
  if (!keyring?.open || typeof buildServices !== 'function') {
    throw new TypeError('memory_runtime_dependencies_required');
  }
  const unlockAttempts = Math.max(1, Number.isInteger(autoUnlockAttempts) ? autoUnlockAttempts : 1);
  let services = null;
  let semanticMode = 'unavailable';
  let backupState = 'disabled';

  const requireUnlocked = () => {
    if (!services) throw new Error('memory_locked');
    return services;
  };

  function status() {
    return Object.freeze({
      locked: !services,
      semanticMode,
      backupState,
      researchEvidence: researchEvidenceCompactor.count(),
    });
  }

  async function activate(masterKey) {
    const key = Buffer.from(masterKey ?? []);
    if (key.length !== 32) throw new Error('invalid_master_key');
    try {
      services = await buildServices(Buffer.from(key));
      if (!services?.memoryService?.recall || !services?.forgetService?.proposeForget
        || !services?.researchService?.readFile || !services?.researchService?.readWeb) {
        services = null;
        throw new Error('memory_services_unavailable');
      }
      semanticMode = services.semanticMode ?? 'lexical_degraded';
      backupState = services.backupState ?? 'disabled';
      return status();
    } finally {
      key.fill(0);
    }
  }

  // Le wrap DPAPI qui protège la clé maître est parfois TRANSITOIREMENT indéchiffrable au tout
  // début d'une session Windows (démarrage au login : safeStorage annonce isEncryptionAvailable
  // avant que la clé de session de l'utilisateur soit montée). Mesuré 2026-07 : le MÊME coffre
  // s'ouvre de façon fiable un instant plus tard (sonde Electron : 3/3 OK en lancement isolé),
  // alors que l'auto-unlock de production alternait succès/échec. Sans phrase, on RÉESSAIE donc
  // quelques fois avant d'abandonner — un seul raté transitoire ne doit pas verrouiller la mémoire
  // toute la session. AVEC phrase : aucun retry (une phrase erronée est définitive, échec immédiat).
  async function unlock({ recoveryPhrase } = {}) {
    if (services) return status();
    if (recoveryPhrase) return activate(await keyring.openWithRecovery(recoveryPhrase));

    let lastError;
    for (let attempt = 0; attempt < unlockAttempts; attempt += 1) {
      try {
        return await activate(await keyring.open());
      } catch (error) {
        lastError = error;
        // On ne réessaie QUE l'indéchiffrabilité transitoire du wrap. Toute autre cause
        // (services indisponibles, clé de mauvaise taille) est structurelle → échec immédiat.
        if (!/keyring_wrapped_key_undecryptable/u.test(String(error?.message ?? ''))) throw error;
        if (attempt + 1 < unlockAttempts) await sleep(autoUnlockDelayMs);
      }
    }
    throw lastError;
  }

  async function initialize() {
    if (!keyring.initialize) throw new Error('keyring_initialize_unavailable');
    const initialized = await keyring.initialize();
    const nextStatus = await activate(initialized.masterKey);
    return Object.freeze({ ...nextStatus, recoveryPhrase: initialized.recoveryPhrase });
  }

  function lock() {
    services?.close?.();
    services = null;
    semanticMode = 'unavailable';
    researchEvidenceCompactor.clear();
    return status();
  }

  async function search({ query = '', revealSensitive = false, limit = 10 } = {}) {
    const active = requireUnlocked();
    const boundedLimit = Math.min(Math.max(Number(limit) || 10, 1), MAX_RECALL_ITEMS);
    const boundedQuery = String(query).slice(0, 1_000);
    const request = {
      kind: 'local_owner', value: 'owner', query: boundedQuery, revealSensitive: revealSensitive === true,
    };
    let recalled;
    let activeSemanticMode = semanticMode;
    if (semanticMode === 'semantic_local' && boundedQuery.trim() && active.memoryService.recallSemantic) {
      try {
        recalled = await active.memoryService.recallSemantic(request);
      } catch (error) {
        if (!/^(?:local_embedding_|lm_studio_embedding_|embedding_model_unavailable)/u.test(error?.message ?? '')) throw error;
        recalled = active.memoryService.recall(request);
        activeSemanticMode = 'semantic_degraded';
      }
    } else {
      recalled = active.memoryService.recall(request);
    }
    const items = recalled.slice(0, boundedLimit).map((item) => publicItem(item, revealSensitive === true));
    return Object.freeze({ items, semanticMode: activeSemanticMode, backupState });
  }

  async function proposeForget({ criteria } = {}) {
    const active = requireUnlocked();
    const proposal = active.forgetService.proposeForget({ criteria, requester: 'local' });
    const confirmed = await confirmLocal({
      reason: 'Cette suppression est définitive et sera propagée aux sauvegardes chiffrées.',
      action: { name: 'memory_forget', proposalId: proposal.id, criteria },
    });
    if (!confirmed) throw new Error('local_forget_confirmation_refused');
    return active.forgetService.confirmForget({ proposalId: proposal.id, confirmedLocally: true });
  }

  async function read(method, input) {
    const active = requireUnlocked();
    const output = await active.researchService[method](input);
    const evidence = Array.isArray(output.evidence) ? output.evidence : [];
    await researchEvidenceCompactor.add(evidence);
    return Object.freeze({ ...output, evidence: Object.freeze([...evidence]) });
  }

  async function missionEvidence({ goal, memoryRequired = false } = {}) {
    if (!services) {
      if (memoryRequired) throw new Error('memory_locked');
      return Object.freeze([]);
    }
    const recalled = await search({ query: goal, revealSensitive: false, limit: 10 });
    return Object.freeze([
      ...recalled.items.filter((item) => !item.masked).map(memoryEvidence),
      ...researchEvidenceCompactor.list(),
    ]);
  }

  // Conversation vocale durable : chaque énoncé (Nasro comme Mina) devient un événement mémoire
  // daté avec provenance. Fail-soft assumé par l'appelant : parler ne doit jamais dépendre du
  // coffre — si la mémoire est verrouillée, l'appelant ignore l'erreur et la voix continue.
  async function rememberUtterance({ role, text, engine = null } = {}) {
    const active = requireUnlocked();
    const speaker = role === 'mina' ? 'Mina' : 'Nasro';
    const trimmed = String(text ?? '').replace(/\s+/gu, ' ').trim().slice(0, 2_000);
    if (!trimmed) throw new TypeError('utterance_invalid');
    await active.memoryService.remember({
      kind: 'local_owner',
      value: 'owner',
      channel: 'voice',
      content: `${speaker} : ${trimmed}`,
      classification: 'normal',
      provenance: { source: 'voice', role: role === 'mina' ? 'mina' : 'owner', engine },
    });
    return Object.freeze({ remembered: true });
  }

  // Reprise de contexte au démarrage d'une session vocale : les derniers échanges, chronologiques.
  // Coffre verrouillé → liste vide silencieuse (la reprise est un bonus, jamais un prérequis).
  async function recentConversation({ limit = 20 } = {}) {
    if (!services) return Object.freeze([]);
    const boundedLimit = Math.max(1, Math.min(Number(limit) || 20, MAX_RECALL_ITEMS));
    const items = await services.memoryService.recall({ kind: 'local_owner', value: 'owner', query: '' });
    return Object.freeze(items
            // Voix ET application Mina : Mina est UNE assistante, pas une par canal — le contexte
      // repris doit refléter tout ce qui a été dit, quel que soit l'appareil.
      .filter((item) => ['voice', 'mina_app'].includes(item.provenance?.source) && !['sensitive', 'secret', 'otp'].includes(item.classification))
      .sort((a, b) => b.date - a.date)
      .slice(0, boundedLimit)
      .reverse()
      .map((item) => Object.freeze({ content: String(item.content).slice(0, 300), date: item.date })));
  }

  /**
   * Échange complet du canal `mina_app` : la question ET la réponse, chacune datée avec sa
   * provenance. Écrire seulement l'une des deux donnerait un historique où Mina paraîtrait
   * n'avoir jamais répondu, ou avoir parlé sans qu'on lui demande rien.
   *
   * L'identifiant d'événement dérive de l'eventId du protocole : une retransmission réseau
   * n'ajoute donc pas un doublon en mémoire.
   */
  async function rememberChatExchange({ eventId, deviceId, userMessage, assistantMessage } = {}) {
    const active = requireUnlocked();
    const question = String(userMessage ?? '').replace(/\s+/gu, ' ').trim().slice(0, 2_000);
    const answer = String(assistantMessage ?? '').replace(/\s+/gu, ' ').trim().slice(0, 2_000);
    if (!question || !answer) throw new TypeError('chat_exchange_invalid');
    if (!DEVICE_ID_PATTERN.test(deviceId ?? '')) throw new TypeError('chat_exchange_device_invalid');
    const base = createHash('sha256').update(`mina_app\0${String(eventId ?? '')}`).digest('hex');

    for (const [suffix, speaker, content] of [
      ['q', 'owner', `Nasro : ${question}`],
      ['r', 'mina', `Mina : ${answer}`],
    ]) {
      await active.memoryService.remember({
        eventId: `chat-${base}-${suffix}`,
        kind: 'local_owner',
        value: 'owner',
        channel: 'mina_app',
        content,
        classification: 'normal',
        provenance: { source: 'mina_app', role: speaker, deviceId },
      });
    }
    return Object.freeze({ remembered: true, eventId: `chat-${base}` });
  }

  async function rememberRemoteMessage(message = {}) {
    const active = requireUnlocked();
    if (Object.keys(message).sort().join(',') !== 'body,channel,deviceId,id,sender,sentAtMs'
      || !REMOTE_ID_PATTERN.test(message.id ?? '')
      || !['sms', 'telegram'].includes(message.channel)
      || typeof message.sender !== 'string' || message.sender.length < 1 || message.sender.length > 160
      || typeof message.body !== 'string' || message.body.length < 1 || message.body.length > 4_096
      || message.body.includes('\0')
      || !Number.isSafeInteger(message.sentAtMs) || message.sentAtMs < 1
      || !DEVICE_ID_PATTERN.test(message.deviceId ?? '')) {
      throw new TypeError('remote_message_invalid');
    }
    const digest = createHash('sha256').update(`${message.channel}\0${message.id}`).digest('hex');
    const eventId = `phone-${digest}`;
    await active.memoryService.remember({
      eventId,
      kind: 'local_owner',
      value: 'owner',
      channel: message.channel,
      content: `De ${message.sender} : ${message.body}`,
      classification: 'sensitive',
      provenance: {
        messageId: message.id,
        sender: message.sender,
        deviceId: message.deviceId,
        sentAtMs: message.sentAtMs,
      },
    });
    return Object.freeze({ eventId, messageId: message.id, channel: message.channel, duplicateSafe: true });
  }

  return Object.freeze({
    status,
    initialize,
    unlock,
    lock,
    search,
    proposeForget,
    readFile: (input) => read('readFile', input),
    readWeb: (input) => read('readWeb', input),
    missionEvidence,
    rememberRemoteMessage,
    rememberUtterance,
    rememberChatExchange,
    recentConversation,
  });
}
