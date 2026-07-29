// Décision de sécurité + provenance pour TOUT média entrant dans une publication. On ne fait JAMAIS
// confiance à l'extension du fichier : le type est déduit des magic bytes réels. Un exécutable déguisé
// en « photo.jpg.exe » est refusé (`publication_asset_media_type_invalid`). Les originaux sont bornés
// (25 MiB) ; les formats matriciels re-encodables sont re-générés par le store (EXIF/GPS retirés).

export const MAX_ASSET_BYTES = 25 * 1024 * 1024; // 25 MiB par original
export const MAX_DIMENSION = 3840; // 4K sur le plus grand côté

export const ALLOWED_MIME = Object.freeze(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/svg+xml', 'image/gif']);
const ALLOWED_SET = new Set(ALLOWED_MIME);

// Formats re-encodables par sharp → EXIF/GPS retirés d'office. HEIC/SVG/GIF passent tels quels.
export const REENCODABLE_MIME = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);

export const SOURCE_KINDS = Object.freeze(['user-file', 'camera-huawei', 'screenshot', 'procedural', 'comfyui-local']);
const SOURCE_KIND_SET = new Set(SOURCE_KINDS);

export const MIME_EXTENSION = Object.freeze({
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'image/heic': 'heic', 'image/svg+xml': 'svg', 'image/gif': 'gif',
});

export function detectMediaType(buffer) {
  if (!buffer || buffer.length < 12) return null;
  const b = buffer;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
    && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  // HEIC/HEIF : box « ftyp » (octets 4-7) + marque connue (octets 8-11).
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const brand = b.toString('ascii', 8, 12);
    if (['heic', 'heix', 'hevc', 'mif1', 'heim', 'heis'].includes(brand)) return 'image/heic';
  }
  // SVG : XML texte commençant par <?xml ou <svg (après BOM/espaces).
  const head = b.toString('utf8', 0, Math.min(b.length, 256)).replace(/^﻿/u, '').trimStart();
  if (/^<\?xml/u.test(head) || /^<svg[\s>]/u.test(head)) return 'image/svg+xml';
  return null;
}

// Un GIF animé porte plus d'un Graphic Control Extension (0x21 0xF9). On refuse l'animé (v1 statique).
export function isAnimatedGif(buffer) {
  if (!buffer || detectMediaType(buffer) !== 'image/gif') return false;
  let count = 0;
  for (let i = 0; i < buffer.length - 1; i += 1) {
    if (buffer[i] === 0x21 && buffer[i + 1] === 0xf9) {
      count += 1;
      if (count > 1) return true;
    }
  }
  return false;
}

export function assertSourceKind(kind) {
  const value = String(kind ?? '');
  if (!SOURCE_KIND_SET.has(value)) throw new Error(`publication_asset_source_kind_invalid:${value}`);
  return value;
}

// Décision complète sur un buffer d'original → mime autorisé, ou throw code stable.
export function classifyAsset(buffer) {
  if (!buffer || buffer.length === 0) throw new Error('publication_asset_empty');
  if (buffer.length > MAX_ASSET_BYTES) throw new Error('publication_asset_too_large');
  const mime = detectMediaType(buffer);
  if (!mime || !ALLOWED_SET.has(mime)) throw new Error('publication_asset_media_type_invalid');
  if (mime === 'image/gif' && isAnimatedGif(buffer)) throw new Error('publication_asset_animated_gif_forbidden');
  return mime;
}
