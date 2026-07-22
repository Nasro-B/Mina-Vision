import { createHash } from 'node:crypto';

const MAX_FRAME_BYTES = 20 * 1024 * 1024;

export function createPhoneVisionPipeline({ phoneBridge, ocrProvider, visionProvider, faceRecognizer } = {}) {
  if (!phoneBridge?.observe || !ocrProvider?.recognize || !visionProvider?.analyze) {
    throw new TypeError('phone_vision_dependencies_required');
  }

  async function observe({ prompt = 'Décris précisément ce que Mina voit.', useOcr = true, recognizeFace = false } = {}) {
    if (typeof prompt !== 'string' || prompt.length < 1 || prompt.length > 4_000 || prompt.includes('\0')) {
      throw new TypeError('phone_vision_prompt_invalid');
    }
    if (recognizeFace && !faceRecognizer?.recognize) throw new Error('face_recognition_unavailable');
    const frame = await phoneBridge.observe();
    if (!['image/png', 'image/jpeg'].includes(frame?.mimeType)
      || !Number.isSafeInteger(frame.width) || frame.width < 1 || frame.width > 16_384
      || !Number.isSafeInteger(frame.height) || frame.height < 1 || frame.height > 16_384
      || typeof frame.imageBase64 !== 'string') throw new Error('phone_frame_invalid');
    const image = Buffer.from(frame.imageBase64, 'base64');
    if (image.length < 1 || image.length > MAX_FRAME_BYTES) throw new Error('phone_frame_invalid');
    const imageDigest = `sha256:${createHash('sha256').update(image).digest('hex')}`;
    try {
      const [ocr, vision, face] = await Promise.all([
        useOcr ? ocrProvider.recognize({ image, mimeType: frame.mimeType }) : null,
        visionProvider.analyze({ image, mimeType: frame.mimeType, prompt }),
        recognizeFace ? faceRecognizer.recognize({ image }) : null,
      ]);
      return Object.freeze({
        imageDigest,
        mimeType: frame.mimeType,
        width: frame.width,
        height: frame.height,
        ...(ocr ? { ocr: structuredClone(ocr) } : {}),
        vision: structuredClone(vision),
        ...(face ? { face: structuredClone(face) } : {}),
      });
    } finally {
      image.fill(0);
    }
  }

  return Object.freeze({ observe });
}
