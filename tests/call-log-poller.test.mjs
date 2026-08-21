import { describe, expect, it, vi } from 'vitest';
import { createCallLogPoller } from '../src/communications/call-log-poller.mjs';

function fakeDomain() {
  const calls = [];
  return {
    calls,
    ingestCallLog: (deviceId, text) => { calls.push({ deviceId, text }); return { processed: 1, missed: 1, tasksQueued: 1, deduped: 0 }; },
  };
}

describe('call-log-poller', () => {
  it('interroge le journal d’appels d’un téléphone via ADB et l’ingère', async () => {
    const domain = fakeDomain();
    const runAdbShell = vi.fn(async () => 'Row: 0 number=+33612345678, type=3, date=1, duration=0');
    const poller = createCallLogPoller({ domain, runAdbShell });
    const report = await poller.pollDevice({ deviceId: 'dev-A', serial: 'HW123' });
    expect(runAdbShell).toHaveBeenCalledWith('HW123', expect.stringContaining('content://call_log/calls'));
    expect(domain.calls[0].deviceId).toBe('dev-A');
    expect(report).toMatchObject({ tasksQueued: 1 });
  });

  it('poll tous les téléphones ; une erreur ADB sur l’un n’arrête pas les autres', async () => {
    const domain = fakeDomain();
    const runAdbShell = vi.fn(async (serial) => { if (serial === 'BAD') throw new Error('device offline'); return 'Row: 0 number=+33698765432, type=3, date=2, duration=0'; });
    const poller = createCallLogPoller({ domain, runAdbShell });
    const results = await poller.pollAll([{ deviceId: 'dev-A', serial: 'HW123' }, { deviceId: 'dev-B', serial: 'BAD' }]);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ deviceId: 'dev-A', tasksQueued: 1 });
    expect(results[1]).toMatchObject({ deviceId: 'dev-B' });
    expect(results[1].error).toMatch(/offline/u);
  });

  it('exige domain + runAdbShell', () => {
    expect(() => createCallLogPoller({ domain: {}, runAdbShell: null })).toThrow('call_log_poller_dependencies_required');
  });
});
