// Client du worker de voix locale — même protocole stdio corrélé que le worker desktop, plus un
// canal d'événements streaming : chaque phrase synthétisée remonte via onAudioChunk dès qu'elle
// est prête (PCM16 24 kHz, le format exact du flux Gemini — le renderer les joue à l'identique).
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// La première synthèse après un démarrage à froid inclut le chargement du modèle (~3 s depuis le
// cache) ; les suivantes tiennent le RTF ≈ 0,75 mesuré. 60 s couvre les tirades longues.
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_LINE_LENGTH = 8_000_000;

const defaultSpawnWorker = () => {
  const electronAsNode = Boolean(process.versions.electron && !process.env.MINA_NODE_PATH);
  return spawn(
    process.env.MINA_NODE_PATH || process.execPath,
    [fileURLToPath(new URL('./local-voice-worker.mjs', import.meta.url))],
    {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: electronAsNode ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' } : process.env,
    },
  );
};

export function createLocalVoiceClient({
  spawnWorker = defaultSpawnWorker,
  requestTimeoutMs = DEFAULT_TIMEOUT_MS,
  onAudioChunk = () => {},
  onDiagnostic = () => {},
} = {}) {
  let worker = null;
  const pending = new Map();
  let output = '';
  let closed = false;

  const rejectAll = (message) => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error(message));
    }
    pending.clear();
  };

  const handleLine = (line) => {
    let response;
    try {
      response = JSON.parse(line);
    } catch {
      return; // bruit stdout (progression de téléchargement du modèle) — jamais fatal
    }
    if (response?.event === 'chunk' && typeof response.pcmBase64 === 'string') {
      onAudioChunk(Object.freeze({
        requestId: response.id,
        index: response.index,
        sampleRate: response.sampleRate === 24_000 ? 24_000 : 24_000,
        audio: new Uint8Array(Buffer.from(response.pcmBase64, 'base64')),
      }));
      return;
    }
    const entry = pending.get(response?.id);
    if (!entry) return;
    pending.delete(response.id);
    clearTimeout(entry.timer);
    if (response.ok) entry.resolve(response.result);
    else entry.reject(new Error(String(response.error || 'Erreur voix locale').slice(0, 300)));
  };

  const ensureWorker = () => {
    if (worker) return worker;
    worker = spawnWorker();
    // Le stderr du worker Kokoro était jeté : un échec de chargement de modèle mourait sans trace.
    worker.stderr?.on?.('data', (chunk) => onDiagnostic(String(chunk).slice(0, 300)));
    worker.stdout.on('data', (chunk) => {
      output += chunk.toString('utf8');
      if (output.length > MAX_LINE_LENGTH) { output = ''; return; }
      const lines = output.split('\n');
      output = lines.pop();
      for (const line of lines.filter(Boolean)) handleLine(line);
    });
    worker.on?.('error', () => { rejectAll('Voix locale indisponible.'); worker = null; });
    worker.on?.('exit', () => { rejectAll('Voix locale arrêtée.'); worker = null; });
    return worker;
  };

  const request = (method, params = {}) => {
    if (closed) return Promise.reject(new Error('Client voix locale fermé.'));
    const active = ensureWorker();
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Délai voix locale dépassé pour ${method}.`));
      }, requestTimeoutMs);
      pending.set(id, { resolve, reject, timer });
      active.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  };

  return Object.freeze({
    warmup: () => request('warmup'),
    speak: (text) => request('tts', { text }),
    close: () => {
      if (closed) return;
      closed = true;
      rejectAll('Client voix locale fermé.');
      worker?.kill();
      worker = null;
    },
  });
}
