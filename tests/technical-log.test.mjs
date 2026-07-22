import { describe, expect, it, vi } from 'vitest';
import { createTechnicalLog, createTechnicalLogReader } from '../src/diagnostics/technical-log.mjs';

describe('technical log', () => {
  it('turns technical runtime events into bounded, timestamped entries', () => {
    const onEntry = vi.fn();
    const log = createTechnicalLog({ limit: 2, clock: () => 1_752_000_000_000, onEntry });

    expect(log.recordEvent({ type: 'action_error', action: { name: 'type' }, error: 'browser_text_target_not_focused' }))
      .toMatchObject({ severity: 'error', scope: 'action:type', code: 'action_error' });
    log.recordEvent({ type: 'resilience_retry', operation: 'model_continue', error: 'HTTP 503' });
    log.recordEvent({ type: 'voice_error', error: 'socket_closed' });

    expect(log.list()).toHaveLength(2);
    expect(log.list()[0]).toMatchObject({ scope: 'voice', code: 'voice_error', occurredAt: '2025-07-08T18:40:00.000Z' });
    expect(onEntry).toHaveBeenCalledTimes(3);
  });

  it('redacts secrets from technical messages before exposing them to the renderer', () => {
    const log = createTechnicalLog();

    const entry = log.record({
      severity: 'error', scope: 'provider', code: 'auth_failed',
      message: 'Authorization: Bearer abc.def.ghi api_key=AIza-secret password=hunter2',
    });

    expect(entry.message).not.toContain('abc.def.ghi');
    expect(entry.message).not.toContain('AIza-secret');
    expect(entry.message).not.toContain('hunter2');
    expect(entry.message).toContain('[REDACTED]');
  });

  it('surfaces the real verification reason for action_unverified events', () => {
    // Regression: the orchestrator emits { action, actionResult, state } — the reason lives at
    // actionResult.verification.reason. The mapper only read event.reason/event.error, so every
    // unverified action reached the owner as « Erreur technique sans détail ».
    const log = createTechnicalLog();

    const entry = log.recordEvent({
      type: 'action_unverified',
      action: { name: 'type' },
      actionResult: { verification: { verified: false, reason: 'champ_de_recherche_inchangé' } },
      state: {},
    });

    expect(entry).toMatchObject({ severity: 'warning', scope: 'action:type' });
    expect(entry.message).toContain('champ_de_recherche_inchangé');
    expect(entry.message).not.toContain('Erreur technique sans détail');
  });

  it('ignores normal activity events and supports a local clear', () => {
    const log = createTechnicalLog();
    expect(log.recordEvent({ type: 'action_completed' })).toBeNull();
    log.record({ severity: 'warning', scope: 'camera', code: 'slow', message: 'Image lente' });
    expect(log.clear()).toEqual({ cleared: 1 });
    expect(log.list()).toEqual([]);
  });

  it('exposes only a bounded recent error list to Mina', () => {
    const log = createTechnicalLog();
    log.record({ scope: 'provider:gemini', code: 'quota', message: 'HTTP 429 quota dépassé' });
    log.record({ scope: 'provider:modal', code: 'starting', message: 'HTTP 503 démarrage' });
    const reader = createTechnicalLogReader({ technicalLog: log });

    expect(reader.read({ limit: 1 })).toEqual([
      expect.objectContaining({ scope: 'provider:modal', code: 'starting' }),
    ]);
    expect(reader.read({ limit: 500 })).toHaveLength(2);
  });
});
