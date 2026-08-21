import { describe, expect, it, vi } from 'vitest';
import { createValidationPipeline } from '../src/code/lifecycle/validation-pipeline.mjs';

const allScripts = ['lint', 'typecheck', 'test', 'build'];

describe('validation-pipeline (cycle de vie T3.2)', () => {
  it('exige runCommand', () => {
    expect(() => createValidationPipeline({})).toThrow('run_required');
  });

  it('tout vert → status green + validé', async () => {
    const vp = createValidationPipeline({ runCommand: vi.fn(async () => ({ code: 0 })) });
    const r = await vp.validate({ dir: '/p', scripts: allScripts });
    expect(r).toMatchObject({ validated: true, status: 'green' });
    expect(r.steps.map((s) => s.status)).not.toContain('absent');
  });

  it('une étape ROUGE (test échoue) → status red + non validé', async () => {
    const runCommand = vi.fn(async ({ args }) => ({ code: args.join(' ') === 'test' ? 1 : 0 }));
    const vp = createValidationPipeline({ runCommand });
    const r = await vp.validate({ dir: '/p', scripts: allScripts });
    expect(r).toMatchObject({ validated: false, status: 'red' });
    expect(r.steps.find((s) => s.name === 'test').status).toBe('échoué');
  });

  it('PARTIEL : lint/build absents mais tests verts → validé, rapport distingue absent d’échoué', async () => {
    const vp = createValidationPipeline({ runCommand: vi.fn(async () => ({ code: 0 })) });
    const r = await vp.validate({ dir: '/p', scripts: ['test'] }); // que test
    expect(r).toMatchObject({ validated: true, status: 'partial' });
    expect(r.steps.find((s) => s.name === 'lint').status).toBe('absent');
    expect(r.report).toMatch(/lint:absent/u);
    expect(r.report).toMatch(/absentes/u);
  });

  it('tests ABSENTS → jamais validé (les tests doivent tourner)', async () => {
    const vp = createValidationPipeline({ runCommand: vi.fn(async () => ({ code: 0 })) });
    const r = await vp.validate({ dir: '/p', scripts: ['lint'] });
    expect(r.validated).toBe(false);
    expect(r.steps.find((s) => s.name === 'test').status).toBe('absent');
  });
});
