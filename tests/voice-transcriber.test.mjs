import { describe, it, expect } from 'vitest';
import { createVoiceTranscriber } from '../src/chat/voice-transcriber.mjs';

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

  it('hors-ligne : refuse de télécharger le modèle en douce', async () => {
    const transcribe = createVoiceTranscriber({
      enabled: true, offline: true, decodeAudio: decodeOk, loadPipeline: pipelineOf('x'),
    });
    await expect(transcribe({ audio: Buffer.from([1]) })).rejects.toThrow('stt_modele_absent_mode_hors_ligne');
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
