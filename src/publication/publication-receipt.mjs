// Reçu immuable d'une publication : la PREUVE de ce qui a réellement été écrit — chemin final,
// format, taille en octets, hash SHA-256 du fichier, template utilisé et provenance de chaque asset.
// Jamais de contenu complet ni de secret : c'est ce reçu (pas le fichier) qui circule dans le journal
// d'activité et vers le renderer. Gelé pour qu'aucune couche en aval ne le mute après coup.

const SHA256 = /^[a-f0-9]{64}$/u;

export function createPublicationReceipt({ filePath, format, bytes, sha256, templateId = null, assets = [] } = {}) {
  if (typeof filePath !== 'string' || filePath.trim() === '') throw new TypeError('publication_receipt_path_required');
  if (typeof sha256 !== 'string' || !SHA256.test(sha256)) throw new TypeError('publication_receipt_sha256_invalid');
  const safeAssets = Array.isArray(assets) ? assets : [];
  return Object.freeze({
    filePath,
    format: String(format ?? ''),
    bytes: Number.isFinite(bytes) && bytes >= 0 ? bytes : 0,
    sha256,
    templateId: templateId === null || templateId === undefined ? null : String(templateId),
    assets: Object.freeze(safeAssets.map((asset) => Object.freeze({ ...asset }))),
  });
}
