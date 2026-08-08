// Transcription LOCALE des notes vocales reçues (C3) : m4a → PCM (décodé par l'AudioContext du
// renderer — Chromium sait décoder l'AAC, Node non) → Whisper local (transformers.js, pipeline
// automatic-speech-recognition) → texte. Tout reste sur la machine : aucun octet audio ne part.
//
// Honnête par construction :
//   • désactivé (par défaut) => null, et la perception garde sa note « transcription hors-ligne
//     non activée » — jamais un semblant ;
//   • premier usage : le modèle Whisper est téléchargé UNE fois dans le cache local par
//     transformers.js. En mode hors-ligne, seuls les fichiers déjà présents sont admis ;
//   • échec de décodage/transcription => erreur propagée, la perception la journalise et retombe
//     sur la note honnête.

import { VOICE_SAMPLE_RATE_HZ, isVoicePcmMime, pcm16leToFloat32 } from './voice-pcm.mjs';

const DEFAULT_MODEL = 'Xenova/whisper-small';

export function createVoiceTranscriber({
  enabled = false,
  offline = false,
  model = DEFAULT_MODEL,
  decodeAudio, // async ({ bytesBase64, mimeType }) => { pcm: Float32Array, sampleRate: number }
  loadPipeline, // async (model, { localFilesOnly }) => (pcm|{...}) => { text } — chargé UNE fois puis réutilisé
  logger = null,
} = {}) {
  if (!enabled) return null; // la perception affiche alors l'état honnête « non activée »
  if (typeof decodeAudio !== 'function' || typeof loadPipeline !== 'function') {
    throw new TypeError('voice_transcriber_dependencies_required');
  }

  let pipelinePromise = null;
  const pipelineOnce = () => {
    pipelinePromise ??= (async () => {
      const started = Date.now();
      const pipeline = await loadPipeline(model, { localFilesOnly: offline });
      logger?.append?.({ event: 'stt_local_charge', model, loadMs: Date.now() - started });
      return pipeline;
    })();
    // Un échec de chargement ne doit pas empoisonner définitivement : on réessaiera au prochain appel.
    pipelinePromise.catch(() => { pipelinePromise = null; });
    return pipelinePromise;
  };

  return async function transcribe({ audio, mimeType } = {}) {
    if (!Buffer.isBuffer(audio) || audio.length < 1) throw new Error('stt_audio_invalide');
    const resolvedMime = String(mimeType ?? 'audio/mp4');
    const { pcm, sampleRate } = isVoicePcmMime(resolvedMime)
      ? { pcm: pcm16leToFloat32(audio), sampleRate: VOICE_SAMPLE_RATE_HZ }
      : await decodeAudio({ bytesBase64: audio.toString('base64'), mimeType: resolvedMime });
    if (!pcm || !Number.isFinite(sampleRate) || sampleRate < 8_000) throw new Error('stt_decodage_invalide');
    const pipeline = await pipelineOnce();
    const result = await pipeline(pcm instanceof Float32Array ? pcm : Float32Array.from(pcm), { sampleRate });
    const text = String(result?.text ?? '').trim();
    logger?.append?.({ event: 'stt_local_transcrit', chars: text.length });
    return text;
  };
}

export { DEFAULT_MODEL as VOICE_TRANSCRIBER_DEFAULT_MODEL };
