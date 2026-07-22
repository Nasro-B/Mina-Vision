import { describe, expect, it, vi } from 'vitest';
import { createVoiceIpcController } from '../src/ui/controller.mjs';
import { registerVoiceIpc } from '../src/ui/ipc/voice-ipc.mjs';

function ipcFixture() {
  const handlers = new Map();
  const listeners = new Map();
  return {
    handlers,
    listeners,
    ipcMain: {
      handle: vi.fn((channel, handler) => handlers.set(channel, handler)),
      on: vi.fn((channel, handler) => listeners.set(channel, handler)),
      removeHandler: vi.fn((channel) => handlers.delete(channel)),
      removeListener: vi.fn((channel) => listeners.delete(channel)),
    },
  };
}

function setup() {
  const fixture = ipcFixture();
  const voiceOrchestrator = {
    start: vi.fn(() => ({ id: 'voice-1', state: 'listening' })),
    pushAudio: vi.fn(async () => ({ partial: true })),
    stop: vi.fn(() => ({ id: 'voice-1', state: 'idle', ended: true })),
  };
  const controller = createVoiceIpcController({ voiceOrchestrator });
  const onError = vi.fn();
  registerVoiceIpc({ ipcMain: fixture.ipcMain, controller, onError });
  return { ...fixture, voiceOrchestrator, onError };
}

describe('narrow voice IPC', () => {
  it('starts, forwards a bounded chunk and stops the active session', async () => {
    const { handlers, listeners, voiceOrchestrator } = setup();
    const started = await handlers.get('mina:voice-start')({}, { mode: 'local-only' });
    await listeners.get('mina:voice-input')({}, {
      sessionId: started.id,
      audio: new Uint8Array([1, 0, 2, 0]),
      mimeType: 'audio/pcm;rate=16000',
    });
    const stopped = await handlers.get('mina:voice-stop')({}, { sessionId: started.id });

    expect(voiceOrchestrator.start).toHaveBeenCalledWith({ mode: 'local-only' });
    expect(voiceOrchestrator.pushAudio).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'voice-1', bytes: Buffer.from([1, 0, 2, 0]), mimeType: 'audio/pcm;rate=16000',
    }));
    expect(stopped).toMatchObject({ state: 'idle' });
  });

  it('rejects stale IDs and oversized chunks before the orchestrator', async () => {
    const { handlers, listeners, voiceOrchestrator, onError } = setup();
    await handlers.get('mina:voice-start')({}, {});

    await listeners.get('mina:voice-input')({}, {
      sessionId: 'stale', audio: new Uint8Array([1, 0]), mimeType: 'audio/pcm;rate=16000',
    });
    await listeners.get('mina:voice-input')({}, {
      sessionId: 'voice-1', audio: new Uint8Array(1_000_001), mimeType: 'audio/pcm;rate=16000',
    });

    expect(voiceOrchestrator.pushAudio).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'voice_session_stale' }));
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'voice_chunk_too_large' }));
  });

  it('uses voice-stop for emergency cancellation and clears the session', async () => {
    const { handlers, voiceOrchestrator } = setup();
    await handlers.get('mina:voice-start')({}, {});

    await handlers.get('mina:voice-stop')({}, { sessionId: 'voice-1', emergency: true });

    expect(voiceOrchestrator.stop).toHaveBeenCalledWith('voice-1', 'emergency_stop');
    await expect(handlers.get('mina:voice-stop')({}, { sessionId: 'voice-1' }))
      .rejects.toThrow('voice_session_stale');
  });
});
