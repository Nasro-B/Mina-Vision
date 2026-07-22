import { describe, expect, it, vi } from 'vitest';
import { createVoiceSession } from '../src/voice/voice-session.mjs';

describe('voice session lifecycle', () => {
  it('follows idle → listening → transcribing → thinking → speaking → idle', () => {
    const events = [];
    const session = createVoiceSession({ id: 'voice-1', onEvent: (event) => events.push(event) });

    session.start();
    session.transition('transcribing');
    session.transition('thinking');
    session.transition('speaking');
    session.transition('idle', { reason: 'completed' });

    expect(session.status()).toMatchObject({ id: 'voice-1', state: 'idle', ended: true, endReason: 'completed' });
    expect(events.map(({ type }) => type)).toEqual([
      'session_start', 'voice_state', 'voice_state', 'voice_state', 'voice_state', 'session_end',
    ]);
  });

  it('rejects double start and invalid transitions', () => {
    const session = createVoiceSession({ id: 'voice-1' });
    session.start();

    expect(() => session.start()).toThrow('voice_session_already_started');
    expect(() => session.transition('speaking')).toThrow('voice_transition_invalid:listening:speaking');
  });

  it.each(['listening', 'transcribing', 'thinking', 'speaking'])('stops safely from %s', (target) => {
    const session = createVoiceSession({ id: `voice-${target}` });
    session.start();
    if (target === 'transcribing') session.transition('transcribing');
    if (target === 'thinking') { session.transition('transcribing'); session.transition('thinking'); }
    if (target === 'speaking') {
      session.transition('transcribing'); session.transition('thinking'); session.transition('speaking');
    }

    session.stop('user_stop');

    expect(session.status()).toMatchObject({ state: 'idle', ended: true, endReason: 'user_stop' });
    expect(session.signal().aborted).toBe(true);
  });

  it('times out and ends before the next transition', () => {
    let now = 1_000;
    const session = createVoiceSession({ id: 'voice-timeout', clock: () => now, timeoutMs: 500 });
    session.start();
    now = 1_501;

    expect(() => session.transition('transcribing')).toThrow('voice_session_timeout');
    expect(session.status()).toMatchObject({ state: 'idle', ended: true, endReason: 'timeout' });
  });

  it('supports barge-in by aborting speech and returning to listening', () => {
    const onInterrupt = vi.fn();
    const session = createVoiceSession({ id: 'voice-barge', onInterrupt });
    session.start();
    session.transition('transcribing');
    session.transition('thinking');
    session.transition('speaking');
    const speakingSignal = session.signal();

    session.bargeIn();

    expect(speakingSignal.aborted).toBe(true);
    expect(session.status()).toMatchObject({ state: 'listening', ended: false });
    expect(onInterrupt).toHaveBeenCalledWith(expect.objectContaining({ reason: 'barge_in', from: 'speaking' }));
  });
});
