import { describe, expect, it, vi } from 'vitest';
import { createPhoneVisionPipeline } from '../src/perception/phone-vision-pipeline.mjs';

describe('Huawei live perception pipeline', () => {
  it('combines one bounded phone frame with OCR, vision and local face recognition without returning raw pixels', async () => {
    const frame = Buffer.from('image-bytes');
    const pipeline = createPhoneVisionPipeline({
      phoneBridge: { observe: vi.fn(async () => ({ imageBase64: frame.toString('base64'), mimeType: 'image/png', width: 1080, height: 2340 })) },
      ocrProvider: { recognize: vi.fn(async () => ({ text: 'Google recette gâteau', confidence: 0.91 })) },
      visionProvider: { analyze: vi.fn(async () => ({ description: 'Écran Google', objects: ['screen'] })) },
      faceRecognizer: { recognize: vi.fn(async () => ({ status: 'recognized', identityId: 'nasro', confidence: 0.94, canAuthorize: false })) },
    });

    const result = await pipeline.observe({ prompt: 'Décris ce que Mina voit', useOcr: true, recognizeFace: true });
    expect(result).toMatchObject({
      mimeType: 'image/png', width: 1080, height: 2340,
      ocr: { text: 'Google recette gâteau' }, vision: { description: 'Écran Google' },
      face: { status: 'recognized', identityId: 'nasro', canAuthorize: false },
    });
    expect(result.imageDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(result.imageBase64).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain(frame.toString('base64'));
  });
});
