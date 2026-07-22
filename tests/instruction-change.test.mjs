import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInstructionChangeService } from '../src/instructions/instruction-change.mjs';
import { loadMinaInstructions } from '../src/instructions/mina-instructions.mjs';

let directory;
let filename;
let original;

function digest(content) {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

function replaceLineDiff(content, before, after, headers = ['a/MINA.md', 'b/MINA.md']) {
  const lines = content.split('\n');
  const line = lines.indexOf(before) + 1;
  if (line < 1) throw new Error('fixture_line_missing');
  return `--- ${headers[0]}\n+++ ${headers[1]}\n@@ -${line},1 +${line},1 @@\n-${before}\n+${after}\n`;
}

function proposal(unifiedDiff, overrides = {}) {
  return {
    baseDigest: digest(original),
    unifiedDiff,
    rationale: 'Clarifier une règle sans modifier la sécurité.',
    risk: 'low',
    ...overrides,
  };
}

function setup(confirmLocal = vi.fn(async ({ action }) => ({
  approved: true, token: 'confirmation-1', baseDigest: action.baseDigest, proposedDigest: action.proposedDigest,
}))) {
  const history = { writeEncrypted: vi.fn(async () => {}) };
  return {
    confirmLocal,
    history,
    service: createInstructionChangeService({ filename, confirmLocal, history }),
  };
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'mina-change-'));
  filename = join(directory, 'MINA.md');
  original = await readFile(new URL('../MINA.md', import.meta.url), 'utf8');
  await writeFile(filename, original);
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('validated MINA.md changes', () => {
  it('applies one confirmed digest-bound diff atomically and stores an encrypted prior version', async () => {
    const before = '- Elle annonce clairement une indisponibilité, une preuve insuffisante ou une incertitude. Elle ne simule jamais un résultat d’outil.';
    const after = '- Elle annonce clairement toute indisponibilité, preuve insuffisante ou incertitude. Elle ne simule jamais un résultat d’outil.';
    const { service, history, confirmLocal } = setup();
    const result = await service.apply(proposal(replaceLineDiff(original, before, after)));

    expect(result).toMatchObject({ applied: true, previousDigest: digest(original) });
    expect(await readFile(filename, 'utf8')).toContain(after);
    expect(confirmLocal).toHaveBeenCalledWith(expect.objectContaining({
      action: expect.objectContaining({ name: 'instructions.change', baseDigest: digest(original), risk: 'low' }),
    }));
    expect(history.writeEncrypted).toHaveBeenCalledWith(expect.objectContaining({
      type: 'mina_instruction_backup', value: expect.objectContaining({ content: original, digest: digest(original) }),
    }));
    await expect(loadMinaInstructions({ filename })).resolves.toMatchObject({ digest: result.digest });
  });

  it('rejects stale digests and diffs targeting anything outside MINA.md', async () => {
    const before = '# Mina Vision';
    const diff = replaceLineDiff(original, before, '# Mina Vision locale');
    const { service, confirmLocal } = setup();
    await expect(service.apply(proposal(diff, { baseDigest: 'sha256:stale' }))).rejects.toThrow('instruction_change_stale');
    await expect(service.apply(proposal(replaceLineDiff(original, before, '# Mina Vision locale', ['a/other.md', 'b/other.md']))))
      .rejects.toThrow('instruction_change_target_invalid');
    expect(confirmLocal).not.toHaveBeenCalled();
  });

  it('rejects secret insertion and removal of an immutable section before confirmation', async () => {
    const { service, confirmLocal } = setup();
    const roleLine = '- Elle privilégie l’exécution locale selon le mode choisi, avec fallback fournisseur gouverné et budgets communs.';
    await expect(service.apply(proposal(replaceLineDiff(original, roleLine, 'OPENROUTER_API_KEY=sk-live-secret'))))
      .rejects.toThrow('mina_instructions_secret_forbidden');
    await expect(service.apply(proposal(replaceLineDiff(original, '## Sécurité immuable', '## Sécurité supprimée'))))
      .rejects.toThrow('mina_instructions_section_missing:Sécurité immuable');
    expect(confirmLocal).not.toHaveBeenCalled();
  });

  it('refuses a reused confirmation token even if the file is restored to the original digest', async () => {
    const before = '- Elle privilégie l’exécution locale selon le mode choisi, avec fallback fournisseur gouverné et budgets communs.';
    const after = '- Elle privilégie le mode choisi avec des fallbacks gouvernés et des budgets communs.';
    const { service } = setup();
    const change = proposal(replaceLineDiff(original, before, after));
    await service.apply(change);
    await writeFile(filename, original);
    await expect(service.apply(change)).rejects.toThrow('instruction_change_confirmation_reused');
    expect(await readFile(filename, 'utf8')).toBe(original);
  });

  it('accepts only the exact proposal shape', async () => {
    const { service } = setup();
    await expect(service.apply({ ...proposal('invalid'), hiddenInstruction: 'unsafe' }))
      .rejects.toThrow('instruction_change_proposal_invalid');
  });
});
