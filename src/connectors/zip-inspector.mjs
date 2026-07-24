import AdmZip from 'adm-zip';
import { createHash } from 'node:crypto';

// Inspecteur de paquets connecteurs : la dépendance `zip_inspector` attendue par
// connector-installer. Mêmes gardes anti-bombe que l'installeur de skills (R-02) : nombre
// d'entrées borné, taille déclarée bornée, ratio d'expansion vérifié AVANT toute décompression,
// traversée/chemins absolus refusés. Rend `{valid:false, reason}` plutôt que de lever : c'est
// l'installeur qui décide du message, l'inspecteur ne fait qu'observer.
//
// `packageDigest` = sha256 du CONTENU du paquet (toutes les entrées SAUF manifest.json, triées
// par nom, nom + octets). C'est ce digest que le manifeste signe : le manifeste ne peut donc pas
// se signer lui-même, et remplacer un fichier du paquet invalide la signature.

const MAX_FILES = 500;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const MAX_EXPANSION_RATIO = 100;
const SIGNIFICANT_COMPRESSED_BYTES = 4_096;

export function createZipInspector() {
  return Object.freeze({
    async inspect(bytes) {
      if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
        return Object.freeze({ valid: false, reason: 'connector_package_vide' });
      }
      if (bytes.length > MAX_TOTAL_BYTES) {
        return Object.freeze({ valid: false, reason: 'connector_package_trop_gros' });
      }

      let zip;
      try {
        zip = new AdmZip(bytes);
      } catch {
        return Object.freeze({ valid: false, reason: 'connector_package_zip_invalide' });
      }

      const entries = zip.getEntries().filter((entry) => !entry.isDirectory);
      if (entries.length === 0) return Object.freeze({ valid: false, reason: 'connector_package_vide' });
      if (entries.length > MAX_FILES) return Object.freeze({ valid: false, reason: 'connector_package_trop_de_fichiers' });

      let declaredTotal = 0;
      for (const entry of entries) {
        const name = entry.entryName;
        if (name.includes('..') || name.startsWith('/') || /^[a-zA-Z]:/u.test(name) || name.includes('\\..')) {
          return Object.freeze({ valid: false, reason: 'connector_package_chemin_interdit' });
        }
        const declared = entry.header.size;
        const compressed = entry.header.compressedSize;
        declaredTotal += declared;
        if (declaredTotal > MAX_TOTAL_BYTES) {
          return Object.freeze({ valid: false, reason: 'connector_package_trop_gros_declare' });
        }
        // Anti-bombe : ratio vérifié sur la taille DÉCLARÉE, avant getData().
        if (compressed > SIGNIFICANT_COMPRESSED_BYTES && declared / Math.max(1, compressed) > MAX_EXPANSION_RATIO) {
          return Object.freeze({ valid: false, reason: 'connector_package_bombe_suspectee' });
        }
      }

      const manifestEntry = entries.find((entry) => entry.entryName === 'manifest.json');
      if (!manifestEntry) return Object.freeze({ valid: false, reason: 'connector_manifest_absent' });

      let manifestText;
      try {
        manifestText = manifestEntry.getData().toString('utf8');
      } catch {
        return Object.freeze({ valid: false, reason: 'connector_manifest_illisible' });
      }

      const hash = createHash('sha256');
      for (const entry of entries
        .filter((candidate) => candidate.entryName !== 'manifest.json')
        .sort((a, b) => a.entryName.localeCompare(b.entryName, 'en'))) {
        let data;
        try {
          data = entry.getData();
        } catch {
          return Object.freeze({ valid: false, reason: 'connector_entree_illisible' });
        }
        if (data.length > entry.header.size + 16) {
          // La décompression a rendu PLUS que déclaré : l'en-tête mentait, on refuse tout.
          return Object.freeze({ valid: false, reason: 'connector_package_taille_mensongere' });
        }
        hash.update(entry.entryName, 'utf8');
        hash.update(Buffer.from([0]));
        hash.update(data);
      }

      return Object.freeze({
        valid: true,
        manifestText,
        packageDigest: `sha256:${hash.digest('hex')}`,
        fileCount: entries.length,
      });
    },
  });
}
