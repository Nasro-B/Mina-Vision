import { describe, expect, it, vi } from 'vitest';
import { createRunManager } from '../src/code/lifecycle/run-manager.mjs';

function fakeProc() {
  return { pid: 4242, kill: vi.fn() };
}
const instantWait = async () => {};

describe('run-manager (cycle de vie T3.3)', () => {
  it('exige spawn', () => {
    expect(() => createRunManager({})).toThrow('spawn_required');
  });

  it('sonde verte → started + preuve (jamais « commande partie »)', async () => {
    const proc = fakeProc();
    const rm = createRunManager({ spawn: () => proc, wait: instantWait });
    let calls = 0;
    const probe = vi.fn(async () => { calls += 1; return calls >= 2; }); // verte au 2e essai
    const r = await rm.start({ dir: '/p', command: 'npm', args: ['run', 'dev'], probe });
    expect(r).toMatchObject({ started: true, pid: 4242, proof: 'sonde_verte' });
    expect(rm.isRunning()).toBe(true);
  });

  it('sonde JAMAIS verte → non started, processus arrêté proprement (honnête)', async () => {
    const proc = fakeProc();
    let t = 0;
    const rm = createRunManager({ spawn: () => proc, wait: instantWait, now: () => (t += 300) });
    const r = await rm.start({ dir: '/p', command: 'x', probe: async () => false, timeoutMs: 1_000 });
    expect(r).toMatchObject({ started: false, reason: 'sonde_jamais_verte' });
    expect(proc.kill).toHaveBeenCalled();
    expect(rm.isRunning()).toBe(false);
  });

  it('un seul run : start pendant qu’un run tourne → refus', async () => {
    const rm = createRunManager({ spawn: () => fakeProc(), wait: instantWait });
    await rm.start({ dir: '/p', command: 'x', probe: async () => true });
    await expect(rm.start({ dir: '/q', command: 'y', probe: async () => true })).rejects.toThrow('already_running');
  });

  it('sonde obligatoire (preuve) + stop propre', async () => {
    const proc = fakeProc();
    const rm = createRunManager({ spawn: () => proc, wait: instantWait });
    await expect(rm.start({ dir: '/p', command: 'x' })).rejects.toThrow('probe_required');
    await rm.start({ dir: '/p', command: 'x', probe: async () => true });
    expect(await rm.stop()).toMatchObject({ stopped: true });
    expect(proc.kill).toHaveBeenCalled();
    expect(await rm.stop()).toMatchObject({ stopped: false });
  });
});
