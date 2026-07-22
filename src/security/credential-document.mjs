// Détection des documents credentials (Task 4 / R-03) : un fichier de secrets (client OAuth,
// compte de service, clé privée, cache de tokens, base navigateur) ne doit JAMAIS être lu par
// la recherche fichiers, même à l'intérieur d'une racine approuvée. Détection par chemin ET par
// contenu — le contenu prime : renommer le fichier ne le rend pas lisible.

const PATH_PATTERNS = [
  /client_secret[^\\/]*\.json$/iu,
  /service[-_]?account[^\\/]*\.json$/iu,
  /\.pem$/iu,
  /\.pfx$/iu,
  /\.p12$/iu,
  /\.key$/iu,
  /(?:^|[\\/])(?:token[-_]?cache|refresh[-_]?token)[^\\/]*\.json$/iu,
  /(?:^|[\\/])gcloud[\\/](?:credentials|legacy_credentials|access_tokens)/iu,
  /(?:^|[\\/])\.aws[\\/]credentials$/iu,
  /(?:^|[\\/])(?:login data|web data|cookies)$/iu,
];

const CONTENT_SCAN_LIMIT = 256 * 1024;

function contentReason(text) {
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/u.test(text)) return 'private_key';
  if (/"type"\s*:\s*"service_account"/u.test(text)) return 'service_account';
  if (/"private_key"\s*:/u.test(text)) return 'private_key';
  if (/"client_secret"\s*:/u.test(text)) return 'oauth_client_secret';
  if (/"refresh_token"\s*:/u.test(text)) return 'refresh_token';
  return null;
}

function pathReason(path) {
  const value = String(path ?? '');
  if (!PATH_PATTERNS.some((pattern) => pattern.test(value))) return null;
  if (/client_secret/iu.test(value)) return 'oauth_client_secret';
  if (/service[-_]?account/iu.test(value)) return 'service_account';
  if (/\.(?:pem|pfx|p12|key)$/iu.test(value)) return 'private_key';
  if (/refresh[-_]?token/iu.test(value)) return 'refresh_token';
  return 'credential_store';
}

export function classifyCredentialDocument({ path, bytes } = {}) {
  const byPath = pathReason(path);
  if (byPath) return Object.freeze({ sensitive: true, reason: byPath });
  if (bytes && bytes.length > 0) {
    // Décodage tolérant borné : un credential est du texte ; les binaires purs sortent null.
    const sample = new TextDecoder('utf-8', { fatal: false })
      .decode(bytes.subarray(0, Math.min(bytes.length, CONTENT_SCAN_LIMIT)));
    const byContent = contentReason(sample);
    if (byContent) return Object.freeze({ sensitive: true, reason: byContent });
  }
  return Object.freeze({ sensitive: false, reason: null });
}
