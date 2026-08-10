import { describe, it, expect, vi } from 'vitest';
import { createVoiceTranscriber } from '../src/chat/voice-transcriber.mjs';
import { VOICE_PCM_MIME } from '../src/chat/voice-pcm.mjs';

const decodeOk = async () => ({ pcm: new Float32Array([0.1, 0.2]), sampleRate: 16_000 });
const pipelineOf = (text) => async () => async () => ({ text });

describe('createVoiceTranscriber', () => {
  it('désactivé (défaut) => null — la perception garde sa note honnête', () => {
    expect(createVoiceTranscriber({})).toBeNull();
    expect(createVoiceTranscriber({ enabled: false, decodeAudio: decodeOk, loadPipeline: pipelineOf('x') })).toBeNull();
  });

  it('activé sans dépendances => refus net', () => {
    expect(() => createVoiceTranscriber({ enabled: true })).toThrow('voice_transcriber_dependencies_required');
  });

  it('transcrit : décode puis passe le PCM au pipeline, texte trimé', async () => {
    let loaded = 0;
    const transcribe = createVoiceTranscriber({
      enabled: true,
      decodeAudio: decodeOk,
      loadPipeline: async () => { loaded += 1; return async () => ({ text: '  bonjour Mina  ' }); },
    });
    expect(await transcribe({ audio: Buffer.from([1, 2, 3]), mimeType: 'audio/mp4' })).toBe('bonjour Mina');
    expect(await transcribe({ audio: Buffer.from([4, 5, 6]), mimeType: 'audio/mp4' })).toBe('bonjour Mina');
    expect(loaded).toBe(1); // pipeline chargé UNE fois puis réutilisé
  });

  it('transcrit le PCM canonique sans demander de décodage au renderer', async () => {
    const decodeAudio = vi.fn();
    const pipeline = vi.fn(async (pcm, options) => ({ text: `${pcm.length}:${options.sampleRate}` }));
    const transcribe = createVoiceTranscriber({
      enabled: true,
      decodeAudio,
      loadPipeline: async () => pipeline,
    });

    await expect(transcribe({
      audio: Buffer.from([0x00, 0x80, 0xff, 0x7f]),
      mimeType: VOICE_PCM_MIME,
    })).resolves.toBe('2:16000');
    expect(decodeAudio).not.toHaveBeenCalled();
  });

  it('charge par défaut la variante q8 compatible avec le runtime CPU local', async () => {
    const transcribe = createVoiceTranscriber({
      enabled: true,
      decodeAudio: decodeOk,
      loadPipeline: async (_model, policy) => {
        if (policy?.dtype !== 'q8') throw new Error('stt_cpu_dtype_required');
        return async () => ({ text: 'transcription q8' });
      },
    });

    await expect(transcribe({ audio: Buffer.from([1]) })).resolves.toBe('transcription q8');
  });

  it('hors-ligne : utilise un pipeline déjà présent sans autoriser le réseau', async () => {
    let receivedPolicy = null;
    const transcribe = createVoiceTranscriber({
      enabled: true,
      offline: true,
      decodeAudio: decodeOk,
      loadPipeline: async (_model, policy) => {
        receivedPolicy = policy;
        if (policy?.localFilesOnly !== true) throw new Error('stt_remote_model_forbidden');
        return async () => ({ text: 'transcription locale' });
      },
    });

    await expect(transcribe({ audio: Buffer.from([1]) })).resolves.toBe('transcription locale');
    expect(receivedPolicy).toEqual({ localFilesOnly: true, dtype: 'q8' });
  });

  it('échec de chargement : réessaiera au prochain appel (pas de poison définitif)', async () => {
    let attempt = 0;
    const transcribe = createVoiceTranscriber({
      enabled: true,
      decodeAudio: decodeOk,
      loadPipeline: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error('reseau_coupe');
        return async () => ({ text: 'ça marche' });
      },
    });
    await expect(transcribe({ audio: Buffer.from([1]) })).rejects.toThrow('reseau_coupe');
    expect(await transcribe({ audio: Buffer.from([1]) })).toBe('ça marche');
  });

  it('audio vide ou décodage invalide => erreur claire', async () => {
    const transcribe = createVoiceTranscriber({
      enabled: true,
      decodeAudio: async () => ({ pcm: null, sampleRate: 0 }),
      loadPipeline: pipelineOf('x'),
    });
    await expect(transcribe({ audio: Buffer.alloc(0) })).rejects.toThrow('stt_audio_invalide');
    await expect(transcribe({ audio: Buffer.from([1]) })).rejects.toThrow('stt_decodage_invalide');
  });
});
