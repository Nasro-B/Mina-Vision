// Résolution de l'identifiant de compte Google (multi-comptes). Le connecteur stockait un
// `accountId` FIGÉ ('google-primary'), donc une 2ᵉ connexion écrasait la 1ère. Ici on dérive un id
// UNIQUE par adresse, avec deux garanties : (1) reconnecter un compte déjà présent réutilise son id
// existant (jamais d'orphelin, jamais de doublon) ; (2) le tout premier compte reste 'google-primary'
// (back-compat : le compte historique de Nasro n'est pas déplacé). Les comptes suivants reçoivent un id
// dérivé de l'email, validé par le format du mail-account-store. Module PUR, testable.

const ACCOUNT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/u;

export function deriveGoogleAccountId(address) {
  const slug = String(address ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  const candidate = `google-${slug}`.slice(0, 64).replace(/-+$/u, '');
  return ACCOUNT_ID.test(candidate) ? candidate : 'google-account';
}

export function resolveGoogleAccountId({ address, existingAccounts = [] } = {}) {
  const normalized = String(address ?? '').toLowerCase();
  const gmail = (existingAccounts ?? []).filter((account) => account?.provider === 'gmail');

  // (1) Reconnexion : l'adresse est déjà connectée → réutiliser son id (rafraîchit le jeton, pas de doublon).
  const match = gmail.find((account) => String(account.address ?? '').toLowerCase() === normalized);
  if (match) return match.accountId;

  // (2) Premier compte Google → id historique, jamais déplacé.
  if (gmail.length === 0) return 'google-primary';

  // (3) Nouveau compte supplémentaire → id dérivé unique (évite 'google-primary' et toute collision).
  const used = new Set((existingAccounts ?? []).map((account) => account.accountId));
  let candidate = deriveGoogleAccountId(address);
  if (candidate === 'google-primary' || used.has(candidate)) {
    let suffix = 2;
    while (used.has(`${candidate}-${suffix}`)) suffix += 1;
    candidate = `${candidate}-${suffix}`;
  }
  return candidate;
}
