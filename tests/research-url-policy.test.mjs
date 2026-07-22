import { describe, expect, it, vi } from 'vitest';
import { createResearchUrlPolicy, isPublicAddress } from '../src/research/url-policy.mjs';

const publicLookup = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);

describe('research url policy (R-07)', () => {
  it('refuse localhost, sous-domaines .localhost, noms .local et credentials dans l\'URL', async () => {
    const policy = createResearchUrlPolicy({ lookup: publicLookup });
    await expect(policy.authorize('http://localhost:1234/admin')).rejects.toThrow('private_network_forbidden');
    await expect(policy.authorize('http://app.localhost/')).rejects.toThrow('private_network_forbidden');
    await expect(policy.authorize('http://imprimante.local/')).rejects.toThrow('private_network_forbidden');
    await expect(policy.authorize('https://user:pass@public.test/')).rejects.toThrow('url_credentials_forbidden');
    await expect(policy.authorize('ftp://public.test/')).rejects.toThrow('unsupported_web_protocol');
    await expect(policy.authorize('pas une url')).rejects.toThrow('research_url_invalid');
  });

  it('refuse toutes les classes IPv4 non publiques en littéral', async () => {
    const policy = createResearchUrlPolicy({ lookup: publicLookup });
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.9', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255']) {
      await expect(policy.authorize(`http://${ip}:1234/`)).rejects.toThrow('private_network_forbidden');
    }
  });

  it('refuse les classes IPv6 non publiques, y compris IPv4-mapped privée', async () => {
    const policy = createResearchUrlPolicy({ lookup: publicLookup });
    for (const ip of ['::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '::ffff:192.168.1.1', '0:0:0:0:0:0:0:1']) {
      await expect(policy.authorize(`http://[${ip}]/`)).rejects.toThrow('private_network_forbidden');
    }
    expect(isPublicAddress('2606:4700::6810:84e5')).toBe(true);
    expect(isPublicAddress('::ffff:8.8.8.8')).toBe(true);
  });

  it('refuse un nom public résolu vers une adresse privée (même partiellement)', async () => {
    const policy = createResearchUrlPolicy({
      lookup: vi.fn(async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '192.168.0.10', family: 4 },
      ]),
    });
    await expect(policy.authorize('https://rebind.test/')).rejects.toThrow('private_network_forbidden');
  });

  it('refuse une résolution DNS vide ou en échec', async () => {
    await expect(createResearchUrlPolicy({ lookup: vi.fn(async () => []) }).authorize('https://vide.test/'))
      .rejects.toThrow('dns_resolution_failed');
    await expect(createResearchUrlPolicy({ lookup: vi.fn(async () => { throw new Error('ENOTFOUND'); }) }).authorize('https://inconnu.test/'))
      .rejects.toThrow('dns_resolution_failed');
  });

  it('autorise une URL publique et retourne url, origin et adresses', async () => {
    const policy = createResearchUrlPolicy({ lookup: publicLookup });
    await expect(policy.authorize('https://public.test/page?q=1')).resolves.toMatchObject({
      origin: 'https://public.test',
      addresses: [{ address: '93.184.216.34', family: 4 }],
    });
  });

  it('n\'accorde la dérogation intranet que si allowPrivateNetwork ET confirmed sont vrais', async () => {
    const policy = createResearchUrlPolicy({ lookup: publicLookup });
    await expect(policy.authorize('http://192.168.1.50/', { allowPrivateNetwork: true }))
      .rejects.toThrow('private_network_forbidden');
    await expect(policy.authorize('http://192.168.1.50/', { confirmed: true }))
      .rejects.toThrow('private_network_forbidden');
    await expect(policy.authorize('http://192.168.1.50/', { allowPrivateNetwork: true, confirmed: true }))
      .resolves.toMatchObject({ origin: 'http://192.168.1.50' });
  });
});
