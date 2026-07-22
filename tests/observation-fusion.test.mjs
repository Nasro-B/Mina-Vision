import { describe, expect, it } from 'vitest';
import { createCameraModality, createOcrModality, createScreenModality, createWebModality } from '../src/perception/multimodal-observation.mjs';
import { fuseObservation } from '../src/perception/observation-fusion.mjs';

describe('multimodal observation contracts', () => {
  it('builds a frozen digest-only screen modality without raw bytes', () => {
    const modality = createScreenModality({ bytes: Buffer.from('screen-pixels'), observedAtMs: 1_000 });
    expect(modality.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(modality.source).toBe('desktop');
    expect(Object.isFrozen(modality)).toBe(true);
    expect(JSON.stringify(modality)).not.toContain('screen-pixels');
  });

  it('rejects a camera modality with an unknown lens', () => {
    expect(() => createCameraModality({ bytes: Buffer.from('x'), deviceId: 'dev-1', lens: 'zoom', observedAtMs: 1_000 }))
      .toThrow('camera_modality_lens_invalid');
  });

  it('rejects a modality with a non-finite timestamp', () => {
    expect(() => createWebModality({ bytes: Buffer.from('x'), observedAtMs: Number.NaN }))
      .toThrow('web_modality_time_invalid');
  });

  it('freezes OCR block arrays deeply enough to prevent mutation', () => {
    const modality = createOcrModality({ blocks: [{ text: 'Bonjour' }], modelId: 'local-ocr-v1', observedAtMs: 1_000 });
    expect(Object.isFrozen(modality.blocks)).toBe(true);
    expect(Object.isFrozen(modality.blocks[0])).toBe(true);
  });
});

describe('observation fusion window', () => {
  it('marks modalities aligned when within the 750ms fusion window', () => {
    const screen = createScreenModality({ bytes: Buffer.from('s'), observedAtMs: 10_000 });
    const camera = createCameraModality({ bytes: Buffer.from('c'), deviceId: 'dev-1', lens: 'front', observedAtMs: 10_700 });

    const observation = fuseObservation({ modalities: { screen, camera } });

    expect(observation.synchronization).toBe('aligned');
    expect(observation.modalities.screen).toMatchObject({ source: 'desktop' });
    expect(observation.modalities.camera).toMatchObject({ source: 'phone-camera', deviceId: 'dev-1', lens: 'front' });
    expect(observation.observedAt).toBe(new Date(10_700).toISOString());
    expect(Object.isFrozen(observation)).toBe(true);
    expect(Object.isFrozen(observation.modalities)).toBe(true);
  });

  it('marks modalities unaligned and never silently claims simultaneity outside the window', () => {
    const screen = createScreenModality({ bytes: Buffer.from('s'), observedAtMs: 10_000 });
    const camera = createCameraModality({ bytes: Buffer.from('c'), deviceId: 'dev-1', lens: 'front', observedAtMs: 10_751 });

    const observation = fuseObservation({ modalities: { screen, camera } });

    expect(observation.synchronization).toBe('unaligned');
  });

  it('keeps independent provenance per modality with no cross-modality leakage', () => {
    const screen = createScreenModality({ bytes: Buffer.from('s'), observedAtMs: 1_000 });
    const web = createWebModality({ bytes: Buffer.from('w'), observedAtMs: 1_100 });
    const ocr = createOcrModality({ blocks: [{ text: 'Recette' }], modelId: 'local-ocr-v1', observedAtMs: 1_150 });

    const observation = fuseObservation({ modalities: { screen, web, ocr } });

    expect(Object.keys(observation.modalities).sort()).toEqual(['ocr', 'screen', 'web']);
    expect(observation.modalities.screen.digest).not.toBe(observation.modalities.web.digest);
  });

  it('rejects fusion with no modalities at all', () => {
    expect(() => fuseObservation({ modalities: {} })).toThrow('observation_fusion_empty');
  });

  it('ignores explicitly null modalities instead of fusing them', () => {
    const screen = createScreenModality({ bytes: Buffer.from('s'), observedAtMs: 1_000 });
    const observation = fuseObservation({ modalities: { screen, camera: null } });
    expect(Object.keys(observation.modalities)).toEqual(['screen']);
  });
});
