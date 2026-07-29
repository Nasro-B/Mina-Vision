import { join } from 'node:path';
import {
  MAX_DIMENSION, MIME_EXTENSION, REENCODABLE_MIME, assertSourceKind, classifyAsset,
} from './asset-policy.mjs';

// Stockage normalisé des assets d'une publication. Copie chaque original sous un identifiant ALÉATOIRE
// dans le dossier d'assets, calcule son SHA-256, RETIRE les métadonnées (EXIF/GPS) des formats
// matriciels via sharp, et ne retient que { provenance (sourceKind), digest, dimensions, date } —
// jamais le chemin source. Toutes les dépendances système (fs, sharp, hash, id) sont injectées : le
// store est testable sans disque ni image réelle et ne prend jamais un chemin arbitraire à l'exécution.
export function createAssetStore({
  readFile, writeFile, mkdir, sharp = null, hash, baseDir, randomId, now = () => 0,
} = {}) {
  if (typeof readFile !== 'function' || typeof writeFile !== 'function' || typeof mkdir !== 'function'
    || typeof hash !== 'function' || typeof randomId !== 'function' || typeof baseDir !== 'string' || !baseDir) {
    throw new TypeError('asset_store_dependencies_required');
  }
  return Object.freeze({
    async importLocal({ sourcePath, sourceKind } = {}) {
      const provenance = assertSourceKind(sourceKind);
      if (typeof sourcePath !== 'string' || sourcePath.trim() === '') throw new Error('publication_asset_source_path_required');

      const original = await readFile(sourcePath);
      const mimeType = classifyAsset(original);

      let bytes = original;
      let dimensions = null;
      if (REENCODABLE_MIME.includes(mimeType) && sharp) {
        // rotate() applique l'orientation EXIF, puis on ré-encode SANS métadonnées → EXIF/GPS retirés,
        // et on borne le plus grand côté à 3840 px sans jamais agrandir.
        bytes = await sharp(original)
          .rotate()
          .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
          .toBuffer();
        const meta = await sharp(bytes).metadata();
        dimensions = { width: meta?.width ?? null, height: meta?.height ?? null };
      }

      const assetId = String(randomId());
      const path = join(baseDir, `${assetId}.${MIME_EXTENSION[mimeType] ?? 'bin'}`);
      await mkdir(baseDir, { recursive: true });
      await writeFile(path, bytes);

      return Object.freeze({
        assetId,
        path,
        mimeType,
        provenance,
        sha256: hash(bytes),
        dimensions,
        bytes: bytes.length,
        importedAt: now(),
      });
    },
  });
}
