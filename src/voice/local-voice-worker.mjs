// Voix locale de secours — process Node ENFANT (jamais dans Electron : l'ONNX natif y casserait
// l'ABI, et l'inférence CPU n'y volerait aucun cycle du renderer). Kokoro-82M q4 + voix française
// ff_siwis (assets/voices), phonémisation espeak-ng wasm. Un événement par phrase synthétisée :
// le client rejoue chaque morceau dès qu'il arrive — premier son vite, lecture continue à RTF < 1.
import { createInterface } from 'node:readline';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { KokoroTTS } from 'kokoro-js';
import ESpeakNg from 'espeak-ng';
import { floatToPcm16, sliceStyleVector, splitSentences } from './local-voice-synthesis.mjs';
import { applyLocalVoiceOfflinePolicy } from './local-voice-offline-policy.mjs';

// Cache modèles → root canonique (déjà peuplé par la vérification d'installation).
// Cache des modèles : déportable par variable d'environnement (MINA_MODELS_ROOT, posée par le
// processus principal), sinon le défaut du runtime — aucun chemin de disque en dur, sinon
// l'app ne démarrerait que sur la machine d'origine.
if (process.env.MINA_MODELS_ROOT) process.env.HF_HOME ??= process.env.MINA_MODELS_ROOT;
applyLocalVoiceOfflinePolicy({ offline: process.env.MINA_OFFLINE === 'true' });

const MAX_LINE_LENGTH = 1_000_000;
const VOICE_PATH = fileURLToPath(new URL('../../assets/voices/ff_siwis.bin', import.meta.url));

const respond = (message) => {
  process.stdout.write(`${JSON.stringify(message)}\n`);
};

let ttsPromise = null;
const loadTts = () => {
  ttsPromise ??= (async () => {
    const [tts, styleBytes] = await Promise.all([
      KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q4', device: 'cpu' }),
      readFile(VOICE_PATH),
    ]);
    const style = new Float32Array(styleBytes.buffer, styleBytes.byteOffset, styleBytes.byteLength / 4);
    return { tts, style };
  })();
  return ttsPromise;
};

const phonemizeFrench = async (sentence) => {
  const espeak = await ESpeakNg({
    preRun: [(module) => module.FS.writeFile('input.txt', new Uint8Array(Buffer.from(sentence, 'utf8')))],
    // « -b 1 » SÉPARÉ : la forme collée « -b=1 » est mal parsée par ce build et les accents
    // ressortent en latin-1 (« créateur » → « copyright ») — prouvé sur l'API réelle.
    arguments: ['--phonout', 'generated', '--sep=', '-q', '-b', '1', '--ipa=3', '-v', 'fr-fr', '-f', 'input.txt'],
  });
  return espeak.FS.readFile('generated', { encoding: 'utf8' }).trim().replace(/\n/gu, ' ');
};

const synthesize = async (id, text) => {
  const { tts, style } = await loadTts();
  const sentences = splitSentences(text);
  if (sentences.length === 0) throw new Error('local_voice_text_required');
  let chunkIndex = 0;
  for (const sentence of sentences) {
    const ipa = await phonemizeFrench(sentence);
    if (!ipa) continue;
    const { input_ids } = tts.tokenizer(ipa, { truncation: true });
    const Tensor = input_ids.constructor; // même exemplaire de classe que kokoro-js, sinon rejet
    const inputs = {
      input_ids,
      style: new Tensor('float32', sliceStyleVector(style, input_ids.dims.at(-1)), [1, 256]),
      speed: new Tensor('float32', new Float32Array([1]), [1]),
    };
    const { waveform } = await tts.model(inputs);
    const pcm = floatToPcm16(waveform.data);
    respond({
      id,
      event: 'chunk',
      index: chunkIndex,
      sampleRate: 24_000,
      pcmBase64: Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).toString('base64'),
    });
    chunkIndex += 1;
  }
  return { chunks: chunkIndex };
};

const handle = async (request) => {
  if (!request?.id || typeof request.method !== 'string') throw new Error('Requête voix invalide.');
  switch (request.method) {
    case 'warmup':
      await loadTts();
      return { ready: true };
    case 'tts':
      return synthesize(request.id, String(request.params?.text ?? ''));
    default:
      throw new Error(`Méthode voix interdite: ${request.method}`);
  }
};

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', async (line) => {
  let request;
  try {
    if (line.length > MAX_LINE_LENGTH) throw new Error('Requête voix trop volumineuse.');
    request = JSON.parse(line);
    const result = await handle(request);
    respond({ id: request.id, ok: true, result });
  } catch (error) {
    respond({ id: request?.id ?? null, ok: false, error: String(error?.message || error).slice(0, 300) });
  }
});
