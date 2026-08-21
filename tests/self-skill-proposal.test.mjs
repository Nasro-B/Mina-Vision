import { describe, expect, it, vi } from 'vitest';
import { createSelfSkillProposal } from '../src/code/self/self-skill-proposal.mjs';

function build(over = {}) {
  return {
    skillGenerator: { generate: vi.fn(async (s) => ({ valid: true, name: s.name })) },
    confirm: vi.fn(async () => true),
    registry: { load: vi.fn(async () => {}) },
    ...over,
  };
}

describe('self-skill-proposal (auto-modification T4.5)', () => {
  it('exige générateur + confirm + registre', () => {
    expect(() => createSelfSkillProposal({ skillGenerator: {}, confirm: () => {}, registry: {} })).toThrow('dependencies_required');
  });

  it('propose → générateur valide → confirmation → registre charge', async () => {
    const d = build();
    const r = await createSelfSkillProposal(d).propose({ spec: { name: 'meteo' } });
    expect(r).toMatchObject({ created: true, skill: 'meteo' });
    expect(d.skillGenerator.generate).toHaveBeenCalled(); // validation DÉLÉGUÉE
    expect(d.registry.load).toHaveBeenCalled();
  });

  it('AUCUNE seconde porte : si le générateur existant REFUSE (imbrication/manifeste faux) → refus', async () => {
    const d = build({ skillGenerator: { generate: vi.fn(async () => ({ valid: false, reason: 'imbrication_interdite' })) } });
    const r = await createSelfSkillProposal(d).propose({ spec: { name: 'x' } });
    expect(r).toMatchObject({ created: false, reason: 'imbrication_interdite' });
    expect(d.registry.load).not.toHaveBeenCalled();
  });

  it('confirmation refusée → pas de chargement', async () => {
    const d = build({ confirm: vi.fn(async () => false) });
    const r = await createSelfSkillProposal(d).propose({ spec: { name: 'x' } });
    expect(r).toMatchObject({ created: false, reason: 'refused' });
    expect(d.registry.load).not.toHaveBeenCalled();
  });
});
