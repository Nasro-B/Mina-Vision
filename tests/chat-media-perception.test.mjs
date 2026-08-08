import { describe, it, expect, vi } from 'vitest';
import { createMediaPerception } from '../src/chat/media-perception.mjs';

function harness(overrides = {}) {
  const remembered = [];
  const notified = [];
  const base = {
    loadMedia: async (id) => ({ mediaId: id, mime: 'image/jpeg', bytes: Buffer.from([1, 2, 3, 4]) }),
    rememberExchange: async (entry) => { remembered.push(entry); return { remembered: true }; },
    notify: (event) => notified.push(event),
    logger: { append: () => {} },
  };
  const perception = createMediaPerception({ ...base, ...overrides });
  return { perception, remembered, notified };
}

describe('createMediaPerception', () => {
  it('exige loadMedia et rememberExchange', () => {
    expect(() => createMediaPerception({})).toThrow('media_perception_dependencies_required');
    expect(() => createMediaPerception({ loadMedia: () => {} })).toThrow('media_perception_dependencies_required');
  });

  it('image : la légende de vision devient la réponse de Mina, et l’échange est mémorisé', async () => {
    const { perception, remembered, notified } = harness({
      visionAnalyze: async () => ({ text: 'un chat roux sur un canapé' }),
    });
    const result = await perception.perceive({ deviceId: 'device-abc', eventId: 'evt-1', mediaId: 'm1', mime: 'image/jpeg', sizeBytes: 2048 });
    expect(result.perceived).toBe(true);
    expect(result.caption).toBe('un chat roux sur un canapé');
    expect(remembered).toHaveLength(1);
    expect(remembered[0].assistantMessage).toBe('Je vois : un chat roux sur un canapé');
    expect(remembered[0].userMessage).toContain('[Image envoyée');
    expect(notified[0]).toMatchObject({ type: 'chat_media_received', kind: 'image', caption: 'un chat roux sur un canapé' });
  });

  it('image sans fournisseur de vision : note honnête, aucune légende inventée', async () => {
    const { perception, remembered, notified } = harness({ visionAnalyze: null });
    const result = await perception.perceive({ deviceId: 'device-abc', eventId: 'evt-2', mediaId: 'm2', mime: 'image/jpeg', sizeBytes: 1024 });
    expect(result.perceived).toBe(false);
    expect(result.caption).toBeNull();
    expect(remembered[0].assistantMessage).toMatch(/Analyse visuelle indisponible/);
    expect(notified[0].caption).toBeNull();
  });

  it('vision qui échoue : retombe sur la note honnête, ne propage pas l’erreur', async () => {
    const { perception, remembered } = harness({
      visionAnalyze: async () => { throw new Error('vision_non_configuree'); },
    });
    const result = await perception.perceive({ deviceId: 'device-abc', eventId: 'evt-3', mediaId: 'm3', mime: 'image/jpeg', sizeBytes: 512 });
    expect(result.perceived).toBe(false);
    expect(remembered[0].assistantMessage).toMatch(/Analyse visuelle indisponible/);
  });

  it('image : utilise l’OCR local si la vision échoue et étiquette honnêtement le texte détecté', async () => {
    const ocrRecognize = vi.fn(async () => ({
      text: 'Rendez-vous à 14 h',
      blocks: [{ text: 'Rendez-vous à 14 h', box: [8, 12, 190, 36], confidence: 0.94 }],
      modelId: 'tesseract:eng',
    }));
    const { perception, remembered, notified } = harness({
      visionAnalyze: async () => { throw new Error('vision_indisponible'); },
      ocrRecognize,
    });

    const result = await perception.perceive({ deviceId: 'device-abc', eventId: 'evt-ocr', mediaId: 'm-ocr', mime: 'image/jpeg', sizeBytes: 2_048 });

    expect(result).toMatchObject({ perceived: true, caption: 'Rendez-vous à 14 h', source: 'ocr' });
    expect(remembered[0].assistantMessage).toBe('Texte détecté localement : Rendez-vous à 14 h');
    expect(notified[0]).toMatchObject({ type: 'chat_media_received', kind: 'image', caption: 'Rendez-vous à 14 h', source: 'ocr' });
    expect(ocrRecognize).toHaveBeenCalledWith(expect.objectContaining({ mimeType: 'image/jpeg' }));
  });

  it('note vocale : transcription utilisée quand présente', async () => {
    const { perception, remembered, notified } = harness({
      loadMedia: async (id) => ({ mediaId: id, mime: 'audio/mp4', bytes: Buffer.from([9, 9, 9]) }),
      transcribe: async () => 'rappelle-moi d’acheter du pain',
    });
    const result = await perception.perceive({ deviceId: 'device-abc', eventId: 'evt-4', mediaId: 'm4', mime: 'audio/mp4', sizeBytes: 4096 });
    expect(result.perceived).toBe(true);
    expect(remembered[0].assistantMessage).toBe('Note vocale : « rappelle-moi d’acheter du pain »');
    expect(remembered[0].userMessage).toContain('[Note vocale envoyée');
    expect(notified[0].kind).toBe('voice');
  });

  it('note vocale sans STT : gardée, transcription non activée (honnête)', async () => {
    const { perception, remembered } = harness({
      loadMedia: async (id) => ({ mediaId: id, mime: 'audio/mp4', bytes: Buffer.from([9]) }),
      transcribe: null,
    });
    const result = await perception.perceive({ deviceId: 'device-abc', eventId: 'evt-5', mediaId: 'm5', mime: 'audio/mp4', sizeBytes: 100 });
    expect(result.perceived).toBe(false);
    expect(remembered[0].assistantMessage).toMatch(/Transcription hors-ligne non activée/);
  });

  it('média illisible (bytes null) : incident noté, rien inventé, notify readable=false', async () => {
    const { perception, remembered, notified } = harness({ loadMedia: async () => null });
    const result = await perception.perceive({ deviceId: 'device-abc', eventId: 'evt-6', mediaId: 'm6', mime: 'image/jpeg', sizeBytes: 0 });
    expect(result.perceived).toBe(false);
    expect(remembered[0].assistantMessage).toMatch(/illisible/);
    expect(notified[0].readable).toBe(false);
  });

  it('mémoire verrouillée : la perception ne casse pas, la notification part quand même', async () => {
    const { perception, notified } = harness({
      rememberExchange: async () => { throw new Error('memory_locked'); },
      visionAnalyze: async () => 'une plage',
    });
    const result = await perception.perceive({ deviceId: 'device-abc', eventId: 'evt-7', mediaId: 'm7', mime: 'image/jpeg', sizeBytes: 2048 });
    expect(result.perceived).toBe(true);
    expect(notified[0].caption).toBe('une plage');
  });

  it('remet à zéro les octets déchiffrés après analyse', async () => {
    const bytes = Buffer.from([1, 2, 3, 4, 5]);
    const { perception } = harness({
      loadMedia: async (id) => ({ mediaId: id, mime: 'image/jpeg', bytes }),
      visionAnalyze: async () => 'test',
    });
    await perception.perceive({ deviceId: 'device-abc', eventId: 'evt-8', mediaId: 'm8', mime: 'image/jpeg', sizeBytes: 5 });
    expect([...bytes]).toEqual([0, 0, 0, 0, 0]);
  });
});
