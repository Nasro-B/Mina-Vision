// Recherche T2.1 (SPEC agente-codage V2) : interroge le registre npm en LECTURE (dernière version stable,
// dépréciation, licence). Applique la RÈGLE N°1 de Nasro à Mina : ne JAMAIS deviner une version — la
// VÉRIFIER, avec provenance et date (comme le grounding l'exige). Passe par url-policy (SSRF) si fournie.
// Cache local daté (TTL) pour ne pas marteler le registre. La réponse est toujours { fait + source + date },
// jamais un chiffre nu. `fetchJson` est INJECTÉ → testable sans réseau. Module PUR/injectable.

const NPM_REGISTRY = 'https://registry.npmjs.org/';
// Nom de paquet npm sûr (scopé ou non) — bloque toute injection de chemin/URL.
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]{0,120}$/iu;
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;

export function createPackageRegistry({ fetchJson, urlPolicy = null, now = () => Date.now(), ttlMs = DEFAULT_TTL_MS } = {}) {
  if (typeof fetchJson !== 'function') throw new TypeError('package_registry_fetch_required');
  const cache = new Map();

  async function npmPackage(name) {
    if (!PACKAGE_NAME.test(String(name ?? ''))) throw new TypeError('package_name_invalid');
    const cached = cache.get(name);
    if (cached && now() - cached.at < ttlMs) return cached.result;

    // Scopé : le « / » est encodé, le « @ » reste littéral (forme attendue par le registre).
    const url = `${NPM_REGISTRY}${name.replace(/\//gu, '%2F')}`;
    if (urlPolicy?.authorize) await urlPolicy.authorize(url);
    const data = await fetchJson(url);
    const latest = data?.['dist-tags']?.latest ?? null;
    const versionMeta = latest ? data?.versions?.[latest] : null;

    const result = Object.freeze({
      fact: 'npm_package_version',
      registry: 'npm',
      name,
      latest,
      deprecated: Boolean(versionMeta?.deprecated),
      license: versionMeta?.license ?? data?.license ?? null,
      source: url,
      date: new Date(now()).toISOString(),
    });
    cache.set(name, { at: now(), result });
    return result;
  }

  // Rendu CITÉ (source + date), jamais une version nue présentée comme vérité éternelle.
  function describe(result) {
    if (!result?.latest) return `Version de « ${result?.name ?? '?'} » inconnue (aucune réponse du registre npm).`;
    const dep = result.deprecated ? ' — ⚠️ DÉPRÉCIÉ' : '';
    return `Dernière version stable de « ${result.name} » : ${result.latest} (licence ${result.license ?? 'inconnue'})${dep}. Source : ${result.source}, le ${result.date}.`;
  }

  return Object.freeze({ npmPackage, describe });
}
