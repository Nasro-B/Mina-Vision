// Politique d'URL de la recherche Web (R-07) : bloque SSRF, loopback et réseaux privés AVANT
// toute requête. Chaque nom public est résolu et TOUTES ses adresses doivent être publiques —
// une résolution n'est jamais réutilisée au-delà de l'opération en cours (pas de cache, donc
// pas de rebinding par cache périmé). La vérification porte sur l'URL initiale ET sur l'URL
// finale après navigation (redirections comprises) côté appelant.

import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const FORBIDDEN_HOSTNAME = /^(localhost|.+\.localhost|.+\.local)$/iu;

// Plages IPv4 non publiques : non spécifiée, privées RFC1918, CGNAT, loopback, link-local,
// multicast et réservées/broadcast.
const IPV4_PRIVATE_RANGES = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

function ipv4ToInt(ip) {
  const parts = ip.split('.').map(Number);
  return (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
}

function isPrivateIpv4(ip) {
  const value = ipv4ToInt(ip);
  return IPV4_PRIVATE_RANGES.some(([base, bits]) => (value >>> (32 - bits)) === (ipv4ToInt(base) >>> (32 - bits)));
}

const IPV4_IN_IPV6 = /^(?:::ffff:|::)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/iu;

function expandIpv6Groups(ip) {
  const [head, tail = ''] = ip.split('::');
  const headParts = head ? head.split(':') : [];
  const tailParts = tail ? tail.split(':') : [];
  const missing = 8 - headParts.length - tailParts.length;
  const parts = [...headParts, ...Array(Math.max(missing, 0)).fill('0'), ...tailParts];
  return parts.map((part) => Number.parseInt(part || '0', 16));
}

function isPrivateIpv6(ip) {
  const lower = ip.toLowerCase();
  const embedded = IPV4_IN_IPV6.exec(lower);
  if (embedded) return isPrivateIpv4(embedded[1]);
  const groups = expandIpv6Groups(lower);
  if (groups.length !== 8 || groups.some((group) => !Number.isFinite(group))) return true;
  if (groups.every((group) => group === 0)) return true; // ::
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return true; // ::1
  if ((groups[0] & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((groups[0] & 0xfe00) === 0xfc00) return true; // unique-local fc00::/7
  if ((groups[0] & 0xff00) === 0xff00) return true; // multicast ff00::/8
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    // IPv4-mapped ::ffff:a.b.c.d sous forme hexadécimale.
    return isPrivateIpv4([groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join('.'));
  }
  return false;
}

export function isPublicAddress(address) {
  const family = isIP(String(address ?? ''));
  if (family === 4) return !isPrivateIpv4(address);
  if (family === 6) return !isPrivateIpv6(address);
  return false;
}

export function createResearchUrlPolicy({ lookup = dnsLookup } = {}) {
  async function authorize(url, { allowPrivateNetwork = false, confirmed = false } = {}) {
    let parsed;
    try {
      parsed = new URL(String(url ?? ''));
    } catch {
      throw new Error('research_url_invalid');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('unsupported_web_protocol');
    if (parsed.username || parsed.password) throw new Error('url_credentials_forbidden');

    // La dérogation intranet est one-shot et exige les DEUX drapeaux — jamais implicite.
    const privateAllowed = allowPrivateNetwork === true && confirmed === true;
    const hostname = parsed.hostname.replace(/^\[|\]$/gu, '');

    if (FORBIDDEN_HOSTNAME.test(hostname)) {
      if (!privateAllowed) throw new Error('private_network_forbidden');
      return Object.freeze({ url: parsed.href, origin: parsed.origin, addresses: Object.freeze([]) });
    }

    if (isIP(hostname) > 0) {
      if (!isPublicAddress(hostname) && !privateAllowed) throw new Error('private_network_forbidden');
      return Object.freeze({
        url: parsed.href,
        origin: parsed.origin,
        addresses: Object.freeze([Object.freeze({ address: hostname, family: isIP(hostname) })]),
      });
    }

    let resolved;
    try {
      resolved = await lookup(hostname, { all: true, verbatim: true });
    } catch {
      throw new Error('dns_resolution_failed');
    }
    if (!Array.isArray(resolved) || resolved.length === 0) throw new Error('dns_resolution_failed');
    const addresses = resolved.map((entry) => Object.freeze({
      address: String(entry.address),
      family: Number(entry.family),
    }));
    // Une SEULE adresse non publique suffit à refuser : un attaquant contrôle sa zone DNS et
    // peut mélanger public/privé pour viser le réseau local au gré du round-robin.
    if (addresses.some((entry) => !isPublicAddress(entry.address)) && !privateAllowed) {
      throw new Error('private_network_forbidden');
    }
    return Object.freeze({ url: parsed.href, origin: parsed.origin, addresses: Object.freeze(addresses) });
  }

  return Object.freeze({ authorize });
}
