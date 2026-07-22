export const TOKENIZER_VERSION = 1;

const STOPWORDS = new Set([
  'a', 'au', 'aux', 'avec', 'ce', 'ces', 'dans', 'de', 'des', 'du', 'd', 'elle', 'en',
  'et', 'eux', 'il', 'je', 'la', 'le', 'les', 'leur', 'l', 'lui', 'ma', 'mais', 'me',
  'mes', 'moi', 'mon', 'ne', 'nos', 'notre', 'nous', 'on', 'ou', 'par', 'pas', 'pour',
  'qu', 'que', 'qui', 'sa', 'se', 'ses', 'son', 'sur', 'ta', 'te', 'tes', 'toi', 'ton',
  'tu', 'un', 'une', 'vos', 'votre', 'vous', 'email',
]);

function stemSimplePlural(token) {
  if (token.includes('@') || /^\d+$/u.test(token)) return token;
  if (token.length > 5 && token.endsWith('eaux')) return token.slice(0, -1);
  if (token.length > 4 && /[sx]$/u.test(token)) return token.slice(0, -1);
  return token;
}

export function tokenizeFrench(text) {
  const normalized = String(text ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('fr-FR')
    .replace(/[’]/gu, "'");
  const rawTokens = normalized.match(/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}|[\p{L}\p{N}]+/gu) ?? [];
  return rawTokens
    .filter((token) => !STOPWORDS.has(token))
    .map(stemSimplePlural)
    .filter((token) => token.length > 0 && !STOPWORDS.has(token));
}
