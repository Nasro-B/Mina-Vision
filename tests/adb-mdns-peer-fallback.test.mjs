// Fallback du keeper mDNS Samsung : certains téléphones (Samsung en mode tcpip) ne s'annoncent
// JAMAIS en mDNS — prouvé le 2026-07-22 (adb_wifi_enabled=0, tcpip actif, zéro annonce, seul le
// Huawei visible). Sans fallback, le keeper boucle sur adb_mdns_peer_not_discovered à vie.
// Contrats : (1) mdns muet → tentative sur la DERNIÈRE endpoint connue, MÊME vérification
// d'identité (ro.serialno) ; (2) succès mdns → endpoint mémorisée ; (3) identité différente en
// fallback → déconnexion + échec (jamais un mauvais téléphone) ; (4) rien de connu → erreur d'origine.

import { describe, expect, it, vi } from 'vitest';
import { createAdbMdnsPeerKeeper } from '../src/executors/adb-mdns-peer.mjs';

function buildKeeper({ mdnsOutput = '', identity = 'RZ8SERIAL', recall = null, remember = null } = {}) {
  const commands = [];
  const run = vi.fn(async (file, args) => {
    commands.push(args.join(' '));
    if (args[0] === 'mdns') return { stdout: mdnsOutput, stderr: '' };
    if (args[0] === 'connect') return { stdout: 'connected', stderr: '' };
    if (args[0] === 'disconnect') return { stdout: '', stderr: '' };
    if (args.includes('getprop')) return { stdout: `${identity}\n`, stderr: '' };
    return { stdout: '', stderr: '' };
  });
  const statuses = [];
  const keeper = createAdbMdnsPeerKeeper({
    serial: 'RZ8SERIAL',
    role: 'samsung',
    run,
    onStatus: (status) => statuses.push(status),
    ...(recall ? { recallEndpoint: recall } : {}),
    ...(remember ? { rememberEndpoint: remember } : {}),
  });
  return { keeper, statuses, commands };
}

describe('adb-mdns-peer — fallback dernière endpoint connue', () => {
  it('mdns muet + endpoint connue → connexion fallback avec vérification d\'identité', async () => {
    const recall = vi.fn(async () => '192.168.1.9:5555');
    const { keeper, statuses, commands } = buildKeeper({ mdnsOutput: 'List of discovered mdns services\n', recall });
    await keeper.tick();
    expect(recall).toHaveBeenCalled();
    expect(commands).toContain('connect 192.168.1.9:5555');
    expect(commands.some((entry) => entry.includes('getprop'))).toBe(true);
    expect(statuses.at(-1)).toMatchObject({ connected: true, endpoint: '192.168.1.9:5555', via: 'last_known_endpoint' });
  });

  it('mdns muet + AUCUNE endpoint connue → adb_mdns_peer_not_discovered (comportement d\'origine)', async () => {
    const { keeper, statuses } = buildKeeper({ mdnsOutput: '' });
    await expect(keeper.tick()).rejects.toThrow(/adb_mdns_peer_not_discovered/u);
    expect(statuses.at(-1).connected).toBe(false);
  });

  it('fallback vers un téléphone à la MAUVAISE identité → déconnexion + échec, jamais accepté', async () => {
    const recall = vi.fn(async () => '192.168.1.44:5555');
    const { keeper, commands } = buildKeeper({ mdnsOutput: '', identity: 'AUTRE_TEL', recall });
    await expect(keeper.tick()).rejects.toThrow(/identity_mismatch/u);
    expect(commands).toContain('disconnect 192.168.1.44:5555');
  });

  it('succès via mdns → endpoint MÉMORISÉE pour les prochains fallbacks', async () => {
    const remember = vi.fn(async () => {});
    const { keeper, statuses } = buildKeeper({
      mdnsOutput: 'adb-RZ8SERIAL-abc\t_adb-tls-connect._tcp\t192.168.1.9:5555\n',
      remember,
    });
    await keeper.tick();
    expect(remember).toHaveBeenCalledWith('192.168.1.9:5555');
    expect(statuses.at(-1)).toMatchObject({ connected: true, via: 'mdns' });
  });

  it('une panne de mémorisation ne casse jamais la connexion', async () => {
    const remember = vi.fn(async () => { throw new Error('disque plein'); });
    const { keeper, statuses } = buildKeeper({
      mdnsOutput: 'adb-RZ8SERIAL\t_adb._tcp\t192.168.1.9:5555\n',
      remember,
    });
    await keeper.tick();
    expect(statuses.at(-1).connected).toBe(true);
  });
});
