import { describe, expect, it, vi } from 'vitest';
import { composeSelfBrief, createSelfModel } from '../src/core/self-model.mjs';

function harness({ stored } = {}) {
  const files = new Map(stored ? [['self.json', stored]] : []);
  return {
    files,
    model: createSelfModel({
      statePath: 'self.json',
      readFile: async (path) => {
        if (!files.has(path)) throw new Error('ENOENT');
        return files.get(path);
      },
      writeFile: async (path, content) => { files.set(path, content); },
      now: () => 1_752_900_000_000,
    }),
  };
}

describe('createSelfModel — dérivé des événements réels, jamais de texte libre', () => {
  it('starts from sane defaults when the file is missing or corrupt', async () => {
    const missing = await harness().model.load();
    expect(missing.identity).toContain('Mina Vision');
    expect(missing.currentGoal).toBeNull();

    const corrupt = await harness({ stored: '{invalid json' }).model.load();
    expect(corrupt.identity).toContain('Mina Vision');
  });

  it('tracks the current goal through mission lifecycle events and persists', async () => {
    const { model, files } = harness();
    await model.load();

    model.observeEvent({ type: 'mission_started', state: { goal: 'Ouvre YouTube et mets Cheb Hasni' } });
    expect(model.snapshot().currentGoal).toContain('YouTube');

    model.observeEvent({ type: 'mission_completed', state: { goal: 'Ouvre YouTube et mets Cheb Hasni' } });
    await model.flush();
    expect(model.snapshot().currentGoal).toBeNull();
    expect(model.snapshot().focus).toContain('YouTube');
    expect(JSON.parse(files.get('self.json')).focus).toContain('YouTube');
  });

  it('turns interruptions and degraded domains into bounded uncertainties, deduplicated', async () => {
    const { model } = harness();
    await model.load();
    model.observeEvent({ type: 'mission_stopped', state: { reason: 'safety_blocked' } });
    model.observeEvent({ type: 'mission_stopped', state: { reason: 'safety_blocked' } });
    for (let index = 0; index < 8; index += 1) model.observeEvent({ type: 'domain_degraded', domain: `domaine-${index}` });

    const { uncertainties } = model.snapshot();
    expect(uncertainties.length).toBeLessThanOrEqual(5);
    expect(new Set(uncertainties).size).toBe(uncertainties.length);
    // Les plus RÉCENTES gagnent la place : le doublon safety_blocked n'existe qu'une fois, puis
    // les 8 domaines dégradés le poussent dehors — c'est le decay naturel de la liste bornée.
    expect(uncertainties[0]).toContain('domaine-7');
  });

  it('ignores unrelated events without touching the state or the disk', async () => {
    const { model, files } = harness();
    await model.load();
    const before = model.snapshot();
    model.observeEvent({ type: 'action_completed', action: { name: 'click' } });
    expect(model.snapshot()).toBe(before);
    expect(files.has('self.json')).toBe(false);
  });

  it('never crashes on a failing disk write', async () => {
    const model = createSelfModel({
      statePath: 'self.json',
      readFile: async () => { throw new Error('ENOENT'); },
      writeFile: vi.fn(async () => { throw new Error('EACCES'); }),
    });
    await model.load();
    model.observeEvent({ type: 'mission_started', state: { goal: 'test' } });
    await expect(model.flush()).resolves.toBeUndefined();
  });
});

describe('composeSelfBrief — injectable, court, erreurs lues du journal au moment T', () => {
  it('composes identity, goal, focus, uncertainties and live errors in French', async () => {
    const { model } = harness();
    await model.load();
    model.observeEvent({ type: 'mission_started', state: { goal: 'ranger les fichiers' } });

    const brief = composeSelfBrief(model.snapshot(), {
      recentErrors: [{ scope: 'action:type', code: 'action_error' }, { scope: 'voice', code: 'voice_error' }],
    });

    expect(brief).toContain('Mina Vision');
    expect(brief).toContain('Mission en cours : ranger les fichiers.');
    expect(brief).toContain('action:type (action_error)');
    expect(brief.length).toBeLessThan(700);
  });

  it('says plainly when nothing is running and stays silent about empty sections', () => {
    const brief = composeSelfBrief();
    expect(brief).toContain('Aucune mission en cours.');
    expect(brief).not.toContain('Incertitudes');
    expect(brief).not.toContain('Erreurs récentes');
  });
});
