const START_CHANNEL = 'mina:voice-start';
const STOP_CHANNEL = 'mina:voice-stop';
const INPUT_CHANNEL = 'mina:voice-input';

function bytesFrom(payload) {
  const value = payload?.audio;
  const length = value?.byteLength;
  if (!Number.isSafeInteger(length) || length < 1) throw new TypeError('voice_chunk_invalid');
  if (length > 1_000_000) throw new Error('voice_chunk_too_large');
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  throw new TypeError('voice_chunk_invalid');
}

export function registerVoiceIpc({ ipcMain, controller, onError = () => {} } = {}) {
  if (!ipcMain?.handle || !ipcMain?.on || !controller?.start || !controller?.pushAudio
    || !controller?.stop || !controller?.emergencyStop) {
    throw new TypeError('voice_ipc_dependencies_required');
  }
  let activeSessionId = null;

  const start = async (_event, options = {}) => {
    if (activeSessionId) throw new Error('voice_session_active');
    const session = await controller.start(options);
    if (typeof session?.id !== 'string' || !session.id) throw new Error('voice_session_start_invalid');
    activeSessionId = session.id;
    return session;
  };

  const stop = async (_event, request = {}) => {
    if (!activeSessionId || request.sessionId !== activeSessionId) throw new Error('voice_session_stale');
    const result = request.emergency === true
      ? await controller.emergencyStop(activeSessionId)
      : await controller.stop(activeSessionId);
    activeSessionId = null;
    return result;
  };

  const input = async (_event, payload = {}) => {
    try {
      if (!activeSessionId || payload.sessionId !== activeSessionId) throw new Error('voice_session_stale');
      const bytes = bytesFrom(payload);
      await controller.pushAudio({
        sessionId: activeSessionId,
        bytes,
        mimeType: payload.mimeType,
      });
    } catch (error) {
      onError(error);
    }
  };

  ipcMain.handle(START_CHANNEL, start);
  ipcMain.handle(STOP_CHANNEL, stop);
  ipcMain.on(INPUT_CHANNEL, input);

  return Object.freeze({
    activeSessionId: () => activeSessionId,
    dispose: () => {
      ipcMain.removeHandler?.(START_CHANNEL);
      ipcMain.removeHandler?.(STOP_CHANNEL);
      ipcMain.removeListener?.(INPUT_CHANNEL, input);
      activeSessionId = null;
    },
  });
}
