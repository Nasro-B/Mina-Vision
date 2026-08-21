import { describe, expect, it } from 'vitest';
import { createIntegrationTemplates } from '../src/code/self/self-integration-templates.mjs';

describe('self-integration-templates (auto-modification T4.4)', () => {
  const t = createIntegrationTemplates();

  it('CHAQUE gabarit produit un module ET son test (pas de test → pas de gate)', () => {
    for (const gen of [t.tool({ name: 'Météo Live' }), t.domain({ name: 'agenda' }), t.uiPage({ name: 'rapports' })]) {
      const paths = Object.keys(gen.files);
      expect(paths.some((p) => p.startsWith('tests/') && p.endsWith('.test.mjs'))).toBe(true);
      const testPath = paths.find((p) => p.startsWith('tests/'));
      expect(gen.files[testPath]).toContain("node:test");
      expect(gen.files[testPath].length).toBeGreaterThan(30);
      expect(gen.anchors.length).toBeGreaterThan(0); // points d'ancrage indiqués
    }
  });

  it('gabarit outil : module + test cohérents (kebab/camel), ancrages LIVE_TOOLS', () => {
    const gen = t.tool({ name: 'Météo Live', description: 'donne la météo' });
    expect(gen.files['src/tools/meteo-live.mjs']).toContain('export function meteoLive');
    expect(gen.files['tests/meteo-live.test.mjs']).toContain("import { meteoLive }");
    expect(gen.anchors).toEqual(expect.arrayContaining([expect.stringContaining('LIVE_TOOLS')]));
  });

  it('gabarit domaine : compose-*-domain honnête + son test', () => {
    const gen = t.domain({ name: 'agenda' });
    expect(gen.files['src/agenda/compose-agenda-domain.mjs']).toContain('degraded');
    expect(Object.keys(gen.files).some((p) => p === 'tests/compose-agenda-domain.test.mjs')).toBe(true);
  });

  it('nom vide → refus (jamais de gabarit anonyme)', () => {
    expect(() => t.tool({ name: '!!!' })).toThrow('name_required');
  });
});
