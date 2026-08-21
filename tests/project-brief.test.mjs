import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeProjectBrief, describeBrief, isWithinAllowedRoots, PROJECT_TYPES } from '../src/code/genesis/project-brief.mjs';

const ROOT = path.resolve('/projets');

describe('project-brief (genèse T1.1)', () => {
  it('normalise nom (kebab), type (enum), features bornées', () => {
    const brief = normalizeProjectBrief(
      { name: 'API Notes! ', type: 'api', stack: 'node-fastify', features: ['auth JWT', '  ', 'CRUD notes'], targetDir: path.join(ROOT, 'api-notes') },
      { allowedRoots: [ROOT] },
    );
    expect(brief).toMatchObject({ name: 'api-notes', type: 'api', stack: 'node-fastify' });
    expect(brief.features).toEqual(['auth JWT', 'CRUD notes']); // vide retiré
    expect(PROJECT_TYPES).toContain(brief.type);
  });

  it('type inconnu → null (jamais inventé)', () => {
    const brief = normalizeProjectBrief({ name: 'x', type: 'quantum', targetDir: path.join(ROOT, 'x') }, { allowedRoots: [ROOT] });
    expect(brief.type).toBeNull();
  });

  it('REFUSE une cible hors des racines autorisées', () => {
    expect(() => normalizeProjectBrief({ name: 'evil', targetDir: '/etc/passwd-dir' }, { allowedRoots: [ROOT] }))
      .toThrow('project_brief_target_outside_roots');
    // et un chemin qui « ressemble » à la racine sans l'être (/projetsX)
    expect(() => normalizeProjectBrief({ name: 'x', targetDir: `${ROOT}X/y` }, { allowedRoots: [ROOT] }))
      .toThrow('outside_roots');
  });

  it('exige un nom et une cible', () => {
    expect(() => normalizeProjectBrief({ name: '!!!', targetDir: path.join(ROOT, 'a') }, { allowedRoots: [ROOT] })).toThrow('name_required');
    expect(() => normalizeProjectBrief({ name: 'a' }, { allowedRoots: [ROOT] })).toThrow('target_required');
  });

  it('isWithinAllowedRoots : cible sous la racine OK, ailleurs KO', () => {
    expect(isWithinAllowedRoots(path.join(ROOT, 'sub', 'proj'), [ROOT])).toBe(true);
    expect(isWithinAllowedRoots('/autre/proj', [ROOT])).toBe(false);
    expect(isWithinAllowedRoots(path.join(ROOT, 'p'), [])).toBe(false); // aucune racine → refus
  });

  it('describeBrief est lisible et honnête sur ce qui manque', () => {
    const brief = normalizeProjectBrief({ name: 'demo', targetDir: path.join(ROOT, 'demo') }, { allowedRoots: [ROOT] });
    const text = describeBrief(brief);
    expect(text).toContain('« demo »');
    expect(text).toMatch(/type à préciser/); // type null → dit honnêtement
    expect(text).toContain('Dossier :');
  });
});
