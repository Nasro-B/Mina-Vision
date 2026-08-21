import { describe, expect, it, vi } from 'vitest';
import { createRollbackService } from '../src/code/self/rollback-service.mjs';
import { createCheckpointLedger } from '../src/code/self/checkpoint-ledger.mjs';

function ledgerWith() {
  const led = createCheckpointLedger();
  led.record({ commitSha: 'aaaaaaa', origin: 'manual', bootProven: true });
  led.record({ commitSha: 'bbbbbbb', origin: 'self-change', bootProven: true });
  return led;
}
const cleanGit = () => vi.fn(async (args) => (args[0] === 'status' ? { stdout: '' } : { code: 0 }));

describe('rollback-service (timeline T5.2)', () => {
  it('exige ses dépendances', () => {
    expect(() => createRollbackService({ ledger: {}, runGit: () => {}, confirm: () => {}, verifyTargetBoots: () => {} })).toThrow('dependencies_required');
  });

  it('rollback : confirmation → cible boote → reset --hard sur le tag → relance', async () => {
    const runGit = cleanGit();
    const relaunch = vi.fn(async () => {});
    const svc = createRollbackService({ ledger: ledgerWith(), runGit, confirm: async () => true, verifyTargetBoots: async () => ({ passed: true }), relaunch });
    const r = await svc.rollbackTo('mina-self/1');
    expect(r).toMatchObject({ rolled: true, tag: 'mina-self/1', stashed: false });
    expect(runGit).toHaveBeenCalledWith(['reset', '--hard', 'mina-self/1']);
    expect(relaunch).toHaveBeenCalled();
  });

  it('cible dont le boot est CASSÉ → on ne bascule PAS (jamais sur une version cassée)', async () => {
    const runGit = cleanGit();
    const svc = createRollbackService({ ledger: ledgerWith(), runGit, confirm: async () => true, verifyTargetBoots: async () => ({ passed: false }) });
    const r = await svc.rollbackTo('mina-self/1');
    expect(r).toMatchObject({ rolled: false, reason: 'cible_boot_casse' });
    expect(runGit).not.toHaveBeenCalledWith(['reset', '--hard', 'mina-self/1']);
  });

  it('arbre SALE → stash de sécurité AVANT reset (rien n’est perdu)', async () => {
    const runGit = vi.fn(async (args) => (args[0] === 'status' ? { stdout: ' M src/a.mjs\n' } : { code: 0 }));
    const svc = createRollbackService({ ledger: ledgerWith(), runGit, confirm: async () => true, verifyTargetBoots: async () => ({ passed: true }) });
    const r = await svc.rollbackTo('mina-self/2');
    expect(r.stashed).toBe(true);
    const calls = runGit.mock.calls.map((c) => c[0].join(' '));
    expect(calls.indexOf('stash push -u -m avant-rollback-mina-self/2')).toBeLessThan(calls.indexOf('reset --hard mina-self/2'));
  });

  it('confirmation refusée / checkpoint inconnu / branche protégée → pas de bascule', async () => {
    const runGit = cleanGit();
    const base = { ledger: ledgerWith(), runGit, verifyTargetBoots: async () => ({ passed: true }) };
    expect(await createRollbackService({ ...base, confirm: async () => false }).rollbackTo('mina-self/1')).toMatchObject({ rolled: false, reason: 'refused' });
    expect(await createRollbackService({ ...base, confirm: async () => true }).rollbackTo('mina-self/99')).toMatchObject({ rolled: false, reason: 'checkpoint_inconnu' });
    expect(await createRollbackService({ ...base, confirm: async () => true, branchGuard: { allowsReset: async () => false } }).rollbackTo('mina-self/1')).toMatchObject({ rolled: false, reason: 'branche_protegee' });
  });

  it('listVersions : liste lisible (tag, date, boot, sha court)', () => {
    const svc = createRollbackService({ ledger: ledgerWith(), runGit: cleanGit(), confirm: async () => true, verifyTargetBoots: async () => ({ passed: true }) });
    const list = svc.listVersions();
    expect(list[0]).toMatchObject({ tag: 'mina-self/1', bootProven: true, sha: 'aaaaaaa' });
  });
});
