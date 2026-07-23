// Contrat du panneau Système (démarrage Windows + catalogue de vérité) : l'UI DOIT exposer le
// réglage de démarrage automatique et l'état réel de chaque domaine. Sans ce contrat, la
// composition runtime (catalogue) resterait invisible comme elle l'a été jusqu'au 2026-07-23.

import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const load = (relative) => readFile(new URL(`../src/ui/${relative}`, import.meta.url), 'utf8');

describe('panneau Système du tableau de bord', () => {
  it('expose le toggle de démarrage Windows et la liste des capacités', async () => {
    const html = await load('index.html');
    expect(html).toContain('id="startup-enabled"');
    expect(html).toContain('id="startup-state"');
    expect(html).toContain('id="capabilities-list"');
    expect(html).toContain('id="capabilities-refresh"');
    expect(html).toContain('Démarrer Mina Vision avec Windows');
  });

  it('le renderer câble le toggle sur l\'état RÉEL relu depuis Windows', async () => {
    const renderer = await load('renderer.js');
    expect(renderer).toContain('api.startupStatus()');
    expect(renderer).toContain('api.setStartup(wanted)');
    // La case reflète le retour de Windows, jamais l'intention seule.
    expect(renderer).toContain('renderStartup({ ...result, supported: true })');
    expect(renderer).toContain("result.applied");
  });

  it('le renderer affiche la raison exacte d\'un domaine dégradé ou indisponible', async () => {
    const renderer = await load('renderer.js');
    expect(renderer).toContain('api.capabilitiesList()');
    expect(renderer).toContain('entry.reason');
    expect(renderer).toContain('badge blocked');
  });

  it('preload et main exposent les deux canaux, sans contournement', async () => {
    const preload = await load('preload.cjs');
    expect(preload).toContain("ipcRenderer.invoke('mina:startup:status')");
    expect(preload).toContain("ipcRenderer.invoke('mina:startup:set'");
    expect(preload).toContain("ipcRenderer.invoke('mina:capabilities:list')");
    const main = await load('main.mjs');
    expect(main).toContain("ipcMain.handle('mina:startup:status'");
    expect(main).toContain("ipcMain.handle('mina:startup:set'");
    // Booléen explicite : jamais une valeur devinée depuis le renderer.
    expect(main).toContain('startupManager.set(payload?.enabled === true)');
  });
});
