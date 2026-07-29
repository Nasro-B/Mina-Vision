import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const preload = readFileSync(new URL('../src/ui/preload.cjs', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/ui/main.mjs', import.meta.url), 'utf8');

const CHANNELS = [
  'mina:publication:templates', 'mina:publication:assets:import',
  'mina:publication:preview', 'mina:publication:publish', 'mina:publication:convert',
];

describe('publication UI contract', () => {
  it('preload expose publication en Object.freeze avec les 5 méthodes validées', () => {
    expect(preload).toContain('publication: Object.freeze');
    for (const channel of CHANNELS) expect(preload).toContain(channel);
  });

  it('preload n’expose AUCUNE primitive fs sous publication', () => {
    const start = preload.indexOf('publication: Object.freeze');
    const block = preload.slice(start, preload.indexOf('}),', start) + 3);
    expect(block).not.toMatch(/writeFile|readFileSync|unlink|\brename\b/u);
  });

  it('main.mjs construit le service publication (paresseux) et enregistre l’IPC', () => {
    expect(main).toContain('registerPublicationIpc');
    expect(main).toContain('const getPublicationService');
    expect(main).toContain("path.join(app.getPath('documents'), 'Mina Vision', 'Publications')");
  });
});
