import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const DEFAULT_TIMEOUT_MS = 10_000;
// Worker responses carry full-screen PNG screenshots as base64: 2-6 MB on a busy 1080p screen,
// well over 20 MB on 4K. The previous 1 MB cap rejected every desktop mission at its FIRST
// observation (« Réponse worker trop volumineuse ») before a single action ran. This bound is a
// memory guard against a runaway worker, not a payload budget — keep it far above any real frame.
const MAX_LINE_LENGTH = 64_000_000;

const defaultSpawnWorker = () => {
  const electronAsNode = Boolean(process.versions.electron && !process.env.MINA_NODE_PATH);
  return spawn(
    process.env.MINA_NODE_PATH || process.execPath,
    [fileURLToPath(new URL('./desktop-worker.mjs', import.meta.url))],
    {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: electronAsNode ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' } : process.env,
    },
  );
};

export function createDesktopClient({
  spawnWorker = defaultSpawnWorker,
  requestTimeoutMs = DEFAULT_TIMEOUT_MS,
  onEvent = () => {},
  onDiagnostic = () => {},
  previewAction = async () => ({ visible: false }),
  hideCursor = async () => ({ visible: false }),
} = {}) {
  const worker = spawnWorker();
  // Le stderr du worker était jeté : un crash natif (nut-js) mourait sans laisser de trace.
  worker.stderr?.on?.('data', (chunk) => onDiagnostic(String(chunk).slice(0, 300)));
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
    if (line.length > MAX_LINE_LENGTH) {
      rejectAll('Réponse worker trop volumineuse.');
      return;
    }

    let response;
    try {
      response = JSON.parse(line);
    } catch {
      rejectAll('Réponse worker invalide.');
      return;
    }

    if (!response.id) {
      onEvent(response);
      return;
    }

    const entry = pending.get(response.id);
    if (!entry) return;
    pending.delete(response.id);
    clearTimeout(entry.timer);

    if (response.ok) entry.resolve(response.result);
    else entry.reject(new Error(String(response.error || 'Erreur worker').slice(0, 300)));
  };

  worker.stdout.on('data', (chunk) => {
    output += chunk.toString('utf8');
    if (output.length > MAX_LINE_LENGTH) {
      rejectAll('Réponse worker trop volumineuse.');
      output = '';
      return;
    }
    const lines = output.split('\n');
    output = lines.pop();
    for (const line of lines.filter(Boolean)) handleLine(line);
  });

  worker.on?.('error', () => rejectAll('Worker Windows indisponible.'));
  worker.on?.('exit', () => rejectAll('Worker Windows arrêté.'));

  const request = (method, params = {}) => {
    if (closed) return Promise.reject(new Error('Client Windows fermé.'));
    const id = randomUUID();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Délai dépassé pour ${method}.`));
      }, requestTimeoutMs);

      pending.set(id, { resolve, reject, timer });
      worker.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  };

  return Object.freeze({
    observe: () => request('observe'),
    execute: (action) => request('execute', { action }),
    previewAction: (action, metadata) => previewAction(action, metadata),
    hideCursor: () => hideCursor(),
    emergencyStop: () => {
      rejectAll('Arrêt d’urgence.');
      void hideCursor();
      return request('release_all_inputs');
    },
    close: () => {
      if (closed) return;
      closed = true;
      rejectAll('Client Windows fermé.');
      void hideCursor();
      worker.kill();
    },
  });
}
