import { describe, expect, it } from 'vitest';
import { composeCapabilityBrief, composeInstructionState } from '../src/core/capability-brief.mjs';

const fullSnapshot = {
  skills: ['file-analysis', 'massage-robot-domicile'],
  bundledSkills: ['research-summary', 'sandbox-code'],
  sandbox: { available: false, reason: 'sandbox_runtimes_unavailable' },
  phone: { connected: true, model: 'Huawei' },
  mail: { implemented: true, configured: true, operational: false },
  googleTasks: { implemented: true, configured: true, operational: false },
  voice: true,
  memoryUnlocked: true,
};

describe('composeCapabilityBrief (spoken self-description from REAL state)', () => {
  it('speaks the real installed skills by name', () => {
    const brief = composeCapabilityBrief(fullSnapshot);
    expect(brief).toContain('file-analysis');
    expect(brief).toContain('massage-robot-domicile');
    expect(brief).toContain('navigateur');
    expect(brief).toContain('téléphone');
  });

  it('says honestly when zero skills are installed', () => {
    const brief = composeCapabilityBrief({ ...fullSnapshot, skills: [] });
    expect(brief).toMatch(/aucun skill install/iu);
    expect(brief).toMatch(/skills int[ée]gr[ée]s.*research-summary/iu);
  });

  it('distinguishes present integrations from operational integrations', () => {
    const brief = composeCapabilityBrief(fullSnapshot);
    expect(brief).toMatch(/e-?mail.*configur[ée].*pas encore op[ée]rationnel/iu);
    expect(brief).toMatch(/Google Tasks.*configur[ée].*pas encore op[ée]rationnel/iu);
  });

  it('states the sandbox as unavailable with a human reason', () => {
    const brief = composeCapabilityBrief(fullSnapshot);
    expect(brief).toMatch(/bac [àa] sable.*(indisponible|d[ée]sactiv)/iu);
  });

  it('reflects a disconnected phone honestly', () => {
    const brief = composeCapabilityBrief({ ...fullSnapshot, phone: { connected: false } });
    expect(brief).toMatch(/t[ée]l[ée]phone.*(non |pas )(connect[ée]|d[ée]tect[ée])/iu);
  });

  it('stays short enough to be spoken without the owner losing patience or the audio being cut short', () => {
    // The full brief is READ ALOUD by the voice model. Measured against the real API: ~942 chars
    // produced ~54 SECONDS of speech, long enough that the owner talks over it (or the mic echo
    // trips barge-in) and hears nothing useful. A spoken answer must stay well under that.
    const worstCase = composeCapabilityBrief({
      skills: ['a', 'b'], bundledSkills: ['file-analysis', 'research-summary', 'sandbox-code', 'massage-robot-domicile'],
      sandbox: { available: false, reason: 'sandbox_runtimes_unavailable' },
      phone: { connected: true, model: 'Huawei' },
      mail: { implemented: true }, googleTasks: { implemented: true },
      googleCalendar: { implemented: true }, googleContacts: { implemented: true },
      memoryUnlocked: true,
    });
    expect(worstCase.length).toBeLessThan(560);
  });

  it('groups every not-yet-configured integration into ONE sentence instead of repeating the same phrase per service', () => {
    const brief = composeCapabilityBrief({
      skills: [], bundledSkills: [], sandbox: { available: true }, phone: { connected: false },
      mail: { implemented: true }, googleTasks: { implemented: true },
      googleCalendar: { implemented: true }, googleContacts: { implemented: true },
      memoryUnlocked: true,
    });
    expect(brief).toMatch(/[Pp]as encore configur[ée]s?\s*:/u);
    // The repetitive per-service wording must be gone.
    expect(brief).not.toMatch(/int[ée]gr[ée] mais pas encore configur[ée].*int[ée]gr[ée] mais pas encore configur[ée]/su);
  });

  it('never produces the ungrammatical "Mes contacts Google est intégré"', () => {
    const brief = composeCapabilityBrief({ googleContacts: { implemented: true, configured: true, operational: false } });
    expect(brief).not.toContain('Mes contacts Google est');
  });

  it('never crashes on an empty snapshot and stays honest', () => {
    const brief = composeCapabilityBrief({});
    expect(brief).toContain('navigateur');
    expect(brief).toMatch(/aucun skill install/iu);
  });
});

describe('composeInstructionState (real state injected into the live system instruction)', () => {
  it('produces a compact factual block for the voice model', () => {
    const block = composeInstructionState(fullSnapshot);
    expect(block).toContain('file-analysis');
    expect(block).toMatch(/sandbox.*indisponible/iu);
    expect(block).toMatch(/t[ée]l[ée]phone.*connect[ée]/iu);
    expect(block).toMatch(/skills int[ée]gr[ée]s.*research-summary/iu);
    expect(block).toMatch(/e-?mail.*non op[ée]rationnel/iu);
  });

  it('stays short enough to not blow up the instruction', () => {
    const block = composeInstructionState(fullSnapshot);
    expect(block.length).toBeLessThan(900);
  });
});
