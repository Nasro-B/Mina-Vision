import { describe, expect, it } from 'vitest';
import {
  ALLOWED_MIME, MAX_ASSET_BYTES, assertSourceKind, classifyAsset, detectMediaType, isAnimatedGif,
} from '../src/publication/asset-policy.mjs';

const pad = (head, size = 16) => {
  const buffer = Buffer.alloc(size);
  Buffer.from(head).copy(buffer);
  return buffer;
};
const JPEG = pad([0xff, 0xd8, 0xff, 0xe0]);
const PNG = pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const GIF = pad([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const WEBP = pad([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const EXE = pad([0x4d, 0x5a, 0x90, 0x00]); // « MZ » : exécutable Windows déguisé
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'utf8');

describe('asset-policy : type par magic bytes, jamais l’extension', () => {
  it('reconnaît JPEG/PNG/GIF/WebP/SVG par leurs octets', () => {
    expect(detectMediaType(JPEG)).toBe('image/jpeg');
    expect(detectMediaType(PNG)).toBe('image/png');
    expect(detectMediaType(GIF)).toBe('image/gif');
    expect(detectMediaType(WEBP)).toBe('image/webp');
    expect(detectMediaType(SVG)).toBe('image/svg+xml');
  });

  it('ne reconnaît pas un exécutable (MZ) → type nul', () => {
    expect(detectMediaType(EXE)).toBeNull();
  });

  it('classifyAsset refuse un exécutable déguisé', () => {
    expect(() => classifyAsset(EXE)).toThrow('publication_asset_media_type_invalid');
  });

  it('classifyAsset refuse un original vide ou hors limite de taille', () => {
    expect(() => classifyAsset(Buffer.alloc(0))).toThrow('publication_asset_empty');
    const huge = Buffer.alloc(13);
    Object.defineProperty(huge, 'length', { value: MAX_ASSET_BYTES + 1 });
    expect(() => classifyAsset(huge)).toThrow('publication_asset_too_large');
  });

  it('refuse un GIF animé (plusieurs blocs 0x21 0xF9)', () => {
    const animated = Buffer.concat([GIF, Buffer.from([0x21, 0xf9, 0, 0x21, 0xf9, 0])]);
    expect(isAnimatedGif(animated)).toBe(true);
    expect(() => classifyAsset(animated)).toThrow('publication_asset_animated_gif_forbidden');
    expect(classifyAsset(GIF)).toBe('image/gif'); // statique = accepté
  });

  it('assertSourceKind n’accepte que les provenances connues', () => {
    expect(assertSourceKind('camera-huawei')).toBe('camera-huawei');
    expect(() => assertSourceKind('internet')).toThrow('publication_asset_source_kind_invalid');
  });

  it('expose la liste des mimes autorisés', () => {
    expect(ALLOWED_MIME).toContain('image/jpeg');
    expect(ALLOWED_MIME).not.toContain('application/x-msdownload');
  });
});
