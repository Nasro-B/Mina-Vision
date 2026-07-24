// Logique PURE du provisionnement des runtimes du bac à sable (aucun réseau, aucun disque).
// Le téléchargement réel vit dans scripts/provision-sandbox-runtimes.mjs (action gated par
// l'autorisation de Nasro). Ici : parsing des fichiers de checksums officiels, sélection de
// version, assemblage du runtime-manifest.json — tout ce qui se teste sans télécharger 100 Mo.

const SHA256 = /^[a-f0-9]{64}$/u;
const REQUIRED_LANGUAGES = Object.freeze(['python', 'javascript', 'powershell']);

/**
 * Décode un fichier de checksums en détectant sa nomenclature d'octets (BOM). PowerShell publie
 * son `hashes.sha256` en UTF-16LE : le lire en UTF-8 donne du charabia et AUCUNE entrée ne matche
 * (le zip passait alors NON vérifié). Node/Python sont en UTF-8. Détection explicite pour ne jamais
 * « rater » une vérification par simple erreur d'encodage.
 */
export function decodeChecksumBytes(buffer) {
  const b = Buffer.from(buffer);
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return b.subarray(2).toString('utf16le');
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) return Buffer.from(b.subarray(2)).swap16().toString('utf16le');
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return b.subarray(3).toString('utf8');
  return b.toString('utf8');
}

/**
 * Parse un fichier de checksums au format « <sha256>  <nom de fichier> » (Node SHASUMS256.txt,
 * PowerShell hashes.sha256). Retourne une Map nom→sha256 minuscule. Lignes malformées ignorées.
 */
export function parseChecksumsFile(text) {
  const map = new Map();
  for (const rawLine of String(text ?? '').split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    // Format GNU coreutils : hash, puis espaces (le second peut être « * » pour binaire), puis nom.
    const match = /^([a-fA-F0-9]{64})\s+\*?(.+)$/u.exec(line);
    if (!match) continue;
    map.set(match[2].trim(), match[1].toLowerCase());
  }
  return map;
}

/** Cherche le sha256 attendu d'un fichier dans une Map de checksums (comparaison par basename). */
export function expectedChecksumFor(checksums, fileName) {
  if (!(checksums instanceof Map)) throw new TypeError('checksums_map_required');
  const wanted = String(fileName ?? '');
  if (checksums.has(wanted)) return checksums.get(wanted);
  const base = wanted.split('/').pop();
  for (const [name, hash] of checksums) {
    if (name === base || name.split('/').pop() === base) return hash;
  }
  return null;
}

/**
 * Sélectionne la dernière version LTS d'une ligne majeure donnée depuis l'index Node
 * (https://nodejs.org/dist/index.json). Retourne { version, dirName } ou null.
 * Ne suppose JAMAIS un numéro de patch : il est lu dans l'index officiel.
 */
export function selectLatestNodeLts(index, majorLine) {
  if (!Array.isArray(index)) throw new TypeError('node_index_array_required');
  const prefix = `v${majorLine}.`;
  const candidates = index
    .filter((entry) => typeof entry?.version === 'string' && entry.version.startsWith(prefix) && entry.lts)
    .map((entry) => entry.version)
    .sort(compareSemverDesc);
  if (!candidates.length) return null;
  const version = candidates[0];
  return Object.freeze({ version, semver: version.replace(/^v/u, '') });
}

/** Compare deux versions « vX.Y.Z » en ordre DÉCROISSANT (pour Array.sort). */
export function compareSemverDesc(a, b) {
  const pa = String(a).replace(/^v/u, '').split('.').map(Number);
  const pb = String(b).replace(/^v/u, '').split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pb[i] ?? 0) - (pa[i] ?? 0);
  }
  return 0;
}

/**
 * Assemble l'objet runtime-manifest.json (schemaVersion 1) à partir des trois runtimes résolus.
 * Chaque entrée : { language, version(semver), sha256(de l'exécutable), sourceUrl(https), path(relatif) }.
 * Valide la forme AVANT écriture pour que le script échoue tôt, jamais avec un manifeste à moitié
 * bon que le guest rejetterait silencieusement.
 */
export function buildRuntimeManifest(entries) {
  if (!Array.isArray(entries) || entries.length !== REQUIRED_LANGUAGES.length) {
    throw new Error('runtime_provisioning_incomplete');
  }
  const byLanguage = new Map();
  for (const entry of entries) {
    const { language, version, sha256, sourceUrl, path } = entry ?? {};
    if (!REQUIRED_LANGUAGES.includes(language)) throw new Error(`runtime_language_invalid:${language}`);
    if (byLanguage.has(language)) throw new Error(`runtime_language_duplicate:${language}`);
    if (typeof version !== 'string' || !/^[0-9]+\.[0-9]+\.[0-9]+/u.test(version)) throw new Error(`runtime_version_invalid:${language}`);
    if (typeof sha256 !== 'string' || !SHA256.test(sha256)) throw new Error(`runtime_sha256_invalid:${language}`);
    if (typeof sourceUrl !== 'string' || !sourceUrl.startsWith('https://')) throw new Error(`runtime_source_invalid:${language}`);
    if (typeof path !== 'string' || !path || path.includes('\\') || path.startsWith('/') || /^[a-z]:/iu.test(path)
      || path.split('/').some((seg) => !seg || seg === '.' || seg === '..')) throw new Error(`runtime_path_invalid:${language}`);
    byLanguage.set(language, Object.freeze({ language, version, sha256: sha256.toLowerCase(), sourceUrl, path }));
  }
  return Object.freeze({
    schemaVersion: 1,
    runtimes: Object.freeze(REQUIRED_LANGUAGES.map((language) => byLanguage.get(language))),
  });
}

export { REQUIRED_LANGUAGES, SHA256 };
