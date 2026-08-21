import { hkdfSync } from 'node:crypto';
import { createAad, decryptAead, encryptAead } from '../crypto/aead.mjs';
import { createCommunicationLedger } from './communication-ledger.mjs';
import { createCommunicationOutbox } from './communication-outbox.mjs';
import { createSmsTaskIngest } from './sms-task-ingest.mjs';
import { createSmsOutboundRouter } from './sms-outbound-router.mjs';
import { createCommunicationTaskDrain } from './communication-task-drain.mjs';
import { createCommunicationTaskSync } from '../personal/communication-task-sync.mjs';
import { createPhoneFleet } from '../devices/phone-fleet.mjs';
import { reconcileFleet } from '../devices/phone-fleet-sync.mjs';
import { createBluetoothHfpMediaAdapter } from '../telephony/bluetooth-hfp-media-adapter.mjs';
import { createCallConversationPolicy } from '../telephony/call-conversation-policy.mjs';
import * as incomingCallPolicy from '../telephony/incoming-call-policy.mjs';

// Composition du domaine COMMUNICATIONS (SPEC-MINA-COMMS-001) : assemble ledger chiffré, flotte,
// outbox durable, ingestion SMS→tâche, routeur sortant, drain Google, adaptateur HFP et politiques
// d'appel en UN domaine cohérent. Fail-honest comme compose-backup-domain : coffre verrouillé →
// `locked` (écritures sensibles refusées, jamais de clair) ; Google non connecté → `degraded`
// (l'ingestion marche, les tâches s'accumulent dans l'outbox durable, jamais perdues) ; sinon
// `operational`. La clé du ledger est dérivée HKDF de la clé maître (jamais la clé maître elle-même).
// Aucun outil PC n'est exposé au domaine (§16). Ce module ASSEMBLE ; il n'est pas encore appelé au boot.

const COMMS_HKDF_INFO = 'communications-ledger v1';

export function deriveCommsKey(masterKey) {
  const source = Buffer.from(masterKey ?? []);
  if (source.length !== 32) throw new TypeError('comms_master_key_required');
  return Buffer.from(hkdfSync(
    'sha256', source, Buffer.from('Mina Vision local memory v1', 'utf8'), Buffer.from(COMMS_HKDF_INFO, 'utf8'), 32,
  ));
}

// Port audio par défaut : aucun matériel HFP. acquire échoue fermé (jamais d'audio général) tant que
// le vrai port Windows n'est pas injecté (activation après la porte live §6).
const STUB_AUDIO_PORT = Object.freeze({
  acquire() { throw new Error('hfp_no_hardware'); },
  release() {},
  probe() { return false; },
});

export function composeCommunicationsDomain({
  masterKey = null, filename, nativeBinding, taskApi = null, taskApiProvider = null, taskStore = null, audioPort = null, now = () => Date.now(),
} = {}) {
  let key = null;
  let seal = null;
  let open = null;
  if (masterKey) {
    key = deriveCommsKey(masterKey);
    seal = (plaintext, { type, id }) => encryptAead({ key, plaintext, aad: createAad({ version: 1, type, id }) });
    open = (envelope, { type, id }) => decryptAead({ key, envelope, aad: createAad({ version: 1, type, id }) });
  }

  const ledger = createCommunicationLedger({ filename, nativeBinding, seal, open, now });
  const outbox = createCommunicationOutbox({ now, store: ledger.outboxStore() });
  const ingest = createSmsTaskIngest({ ledger, outbox });
  const fleet = createPhoneFleet({ now });
  const outboundRouter = createSmsOutboundRouter({ fleet });
  const hfpAdapter = createBluetoothHfpMediaAdapter({ audioPort: audioPort ?? STUB_AUDIO_PORT, now });
  const callPolicy = createCallConversationPolicy();

  // Le taskApi peut être fourni STATIQUEMENT (tests) ou via un PROVIDER lazy (runtime : le compte Google
  // se connecte APRÈS la composition du domaine — le provider le résout au moment du drain, sans redémarrage).
  const resolveTaskApi = () => (typeof taskApiProvider === 'function' ? taskApiProvider() : taskApi);
  const isConnected = () => typeof resolveTaskApi()?.insertTask === 'function';
  const computeState = () => (!masterKey ? 'locked' : (isConnected() ? 'operational' : 'degraded'));

  // Le drain est (re)construit paresseusement quand l'API cible change (Google enfin connecté).
  let cachedApi = null;
  let cachedDrain = null;
  function drainFor(api) {
    if (api !== cachedApi) {
      cachedApi = api;
      const taskSync = createCommunicationTaskSync({ taskApi: api, store: taskStore, outbox: null });
      cachedDrain = createCommunicationTaskDrain({ ledger, outbox, taskSync, now });
    }
    return cachedDrain;
  }

  return Object.freeze({
    state: computeState(),
    reason: !masterKey ? 'coffre_verrouille' : (isConnected() ? null : 'google_tasks_non_connecte'),
    ledger,
    fleet,
    outbox,
    hfpAdapter,
    callPolicy,
    incomingPolicy: {
      evaluateReadiness: incomingCallPolicy.evaluateReadiness,
      evaluateIncomingCall: incomingCallPolicy.evaluateIncomingCall,
    },
    ingestSms: (rawSms) => ingest.ingest(rawSms),
    routeOutbound: (command) => outboundRouter.route(command),
    reconcile: (registry) => reconcileFleet({ fleet, registry }),
    async drainTasks() {
      const api = resolveTaskApi();
      if (typeof api?.insertTask !== 'function') return Object.freeze({ skipped: true, reason: 'google_tasks_non_connecte' });
      return drainFor(api).drainOnce();
    },
    status: () => Object.freeze({ state: computeState(), events: ledger.count(), pendingTasks: outbox.size() }),
    close: () => { try { ledger.close(); } finally { if (key) key.fill(0); } },
  });
}
