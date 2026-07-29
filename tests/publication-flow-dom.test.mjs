// @vitest-environment jsdom
// Parcours PUBLICATIONS réel (harnais jsdom généralisé). Le VRAI index.html + le VRAI renderer.js dans
// jsdom, seul le pont IPC est simulé. Prouve que le bouton « Générer sans IA » appelle
// api.publication.publish avec la bonne STRUCTURE selon le format (blocs pour pdf/docx/texte, slides
// pour pptx, feuilles pour xlsx) et affiche le chemin du reçu. Un bouton mort vire le test au rouge.

import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';

const flush = async (rounds = 6) => {
  for (let index = 0; index < rounds; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

const calls = { publish: [] };
const RESULTS = {
  memoryStatus: () => ({ locked: false, initialized: true }),
  status: () => ({ ok: true, config: { credentialsRotated: true } }),
  readProfiles: () => ({ profiles: [{ id: 'p1', name: 'Nasro', theme: 'system' }], activeProfileId: 'p1', welcomeCompleted: true }),
  readJournal: () => [],
};
const publication = {
  publish: (request) => {
    calls.publish.push(request);
    return { ok: true, receipt: { filePath: `C:/Users/Nasro/Documents/Mina Vision/Publications/bilan.${request.format}`, bytes: 2048, format: request.format, sha256: 'a'.repeat(64) } };
  },
  templates: () => ({ ok: true, templates: [] }),
};
const makeApi = () => new Proxy({ publication }, {
  get: (target, prop) => {
    if (prop === 'publication') return target.publication;
    if (typeof prop !== 'string') return undefined;
    return (...args) => {
      const handler = RESULTS[prop];
      try { return Promise.resolve(handler ? handler(...args) : undefined); }
      catch (error) { return Promise.reject(error); }
    };
  },
});

beforeAll(async () => {
  const html = await readFile('src/ui/index.html', 'utf8');
  document.documentElement.innerHTML = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gu, '');
  window.mina = makeApi();
  window.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  Element.prototype.scrollIntoView ??= function scrollIntoView() {};
  const magic = new Proxy(function magicNoop() {}, {
    get: (_t, prop) => (prop === 'width' || prop === 'height' ? 0 : magic), apply: () => magic, set: () => true,
  });
  window.HTMLCanvasElement.prototype.getContext = () => magic;
  window.requestAnimationFrame ??= (cb) => setTimeout(() => cb(0), 16);
  window.cancelAnimationFrame ??= (handle) => clearTimeout(handle);
  await import('../src/ui/renderer.js');
  await flush();
});

describe('parcours Publications (page UI Task 7)', () => {
  it('« Générer sans IA » (PDF) appelle publish avec des blocs et affiche le chemin', async () => {
    calls.publish.length = 0;
    document.querySelector('#publication-format').value = 'pdf';
    document.querySelector('#publication-title-input').value = 'Bilan 2026';
    document.querySelector('#publication-content').value = '## Résultats\nUn paragraphe.\n- Point A\n- Point B';
    document.querySelector('#publication-generate').click();
    await flush();

    expect(calls.publish, 'publish doit être appelé (sinon bouton mort)').toHaveLength(1);
    expect(calls.publish[0]).toMatchObject({ format: 'pdf', title: 'Bilan 2026' });
    expect(calls.publish[0].blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'heading', text: 'Résultats' }),
      expect.objectContaining({ kind: 'paragraph', text: 'Un paragraphe.' }),
      expect.objectContaining({ kind: 'bullets', items: ['Point A', 'Point B'] }),
    ]));
    expect(document.querySelector('#publication-result').textContent).toContain('Publications');
  });

  it('PPTX construit des slides (cover + puces), pas des blocs', async () => {
    calls.publish.length = 0;
    document.querySelector('#publication-format').value = 'pptx';
    document.querySelector('#publication-title-input').value = 'Présentation';
    document.querySelector('#publication-content').value = 'Idée 1\nIdée 2';
    document.querySelector('#publication-generate').click();
    await flush();

    expect(calls.publish[0].slides).toBeTruthy();
    expect(calls.publish[0].slides[0]).toMatchObject({ kind: 'cover' });
    expect(calls.publish[0].slides[1].bullets).toEqual(['Idée 1', 'Idée 2']);
  });

  it('XLSX construit des feuilles depuis des lignes séparées par « ; »', async () => {
    calls.publish.length = 0;
    document.querySelector('#publication-format').value = 'xlsx';
    document.querySelector('#publication-content').value = 'Mois;Montant\nJanvier;120';
    document.querySelector('#publication-generate').click();
    await flush();

    expect(calls.publish[0].sheets[0].rows).toEqual([['Mois', 'Montant'], ['Janvier', '120']]);
  });
});
