// Oreilles de secours : Deepgram streaming (nova-2, français) prend le micro quand la session
// Gemini Live n'existe pas. Les transcrits finaux repartent dans le MÊME routeur de commandes que
// Gemini — dialogue déterministe + voix locale Kokoro ferment la boucle sans Gemini.
// Auth par sous-protocole WebSocket (['token', clé]) : jamais la clé en URL, et compatible avec le
// WebSocket natif de Node 22/Electron qui n'accepte pas d'en-têtes arbitraires.

const DEEPGRAM_URL = 'wss://api.deepgram.com/v1/listen';
const KEEPALIVE_MS = 8_000;

const buildUrl = ({ model, language, sampleRate, endpointingMs }) => {
  const parameters = new URLSearchParams({
    model,
    language,
    encoding: 'linear16',
    sample_rate: String(sampleRate),
    channels: '1',
    smart_format: 'true',
    interim_results: 'false',
    endpointing: String(endpointingMs),
  });
  return `${DEEPGRAM_URL}?${parameters}`;
};

export function createDeepgramStt({
  apiKey,
  wsFactory = (url, protocols) => new WebSocket(url, protocols),
  model = 'nova-2',
  language = 'fr',
  sampleRate = 16_000,
  endpointingMs = 400,
  onTranscript = () => {},
  onError = () => {},
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
} = {}) {
  if (!apiKey) throw new Error('deepgram_unconfigured');
  let socket = null;
  let keepAliveTimer = null;
  let closed = false;

  const stop = () => {
    if (keepAliveTimer) { clearIntervalImpl(keepAliveTimer); keepAliveTimer = null; }
    if (socket && socket.readyState <= 1) {
      try { socket.send(JSON.stringify({ type: 'CloseStream' })); } catch { /* déjà fermé */ }
      try { socket.close(); } catch { /* déjà fermé */ }
    }
    socket = null;
  };

  const start = () => new Promise((resolve, reject) => {
    if (closed) { reject(new Error('deepgram_session_closed')); return; }
    if (socket && socket.readyState === 1) { resolve({ listening: true }); return; }
    let settled = false;
    const ws = wsFactory(buildUrl({ model, language, sampleRate, endpointingMs }), ['token', apiKey]);
    socket = ws;
    ws.addEventListener('open', () => {
      keepAliveTimer = setIntervalImpl(() => {
        try { ws.send(JSON.stringify({ type: 'KeepAlive' })); } catch { /* socket mort, exit gère */ }
      }, KEEPALIVE_MS);
      keepAliveTimer?.unref?.();
      settled = true;
      resolve({ listening: true });
    });
    ws.addEventListener('message', (event) => {
      try {
        const payload = JSON.parse(typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString('utf8'));
        if (payload.type !== 'Results' || payload.is_final !== true) return;
        const transcript = payload.channel?.alternatives?.[0]?.transcript?.trim();
        if (transcript) onTranscript(transcript);
      } catch { /* trame non JSON : ignorée */ }
    });
    ws.addEventListener('error', (event) => {
      onError(new Error(String(event?.message ?? 'deepgram_socket_error')));
      if (!settled) { settled = true; reject(new Error('deepgram_connect_failed')); }
    });
    ws.addEventListener('close', () => {
      if (keepAliveTimer) { clearIntervalImpl(keepAliveTimer); keepAliveTimer = null; }
      if (socket === ws) socket = null;
      if (!settled) { settled = true; reject(new Error('deepgram_connect_failed')); }
    });
  });

  return Object.freeze({
    start,
    sendPcm16(buffer) {
      if (!socket || socket.readyState !== 1) return false;
      try { socket.send(buffer); return true; } catch { return false; }
    },
    listening: () => Boolean(socket && socket.readyState === 1),
    close() {
      closed = true;
      stop();
    },
  });
}
