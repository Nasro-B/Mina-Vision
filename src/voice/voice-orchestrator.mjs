import { randomUUID } from 'node:crypto';
import { normalizeAudio } from './audio-normalizer.mjs';
import { createVoiceSession } from './voice-session.mjs';
import { detectStopPhrase, detectWakePhrase } from './wake-phrases.mjs';

export function createVoiceOrchestrator({
  capabilityRouter,
  providerRegistry,
  respond,
  audioNormalizer = normalizeAudio,
  sessionFactory = createVoiceSession,
  idFactory = randomUUID,
  onEvent = () => {},
  sessionTimeoutMs = 120_000,
} = {}) {
  if (!capabilityRouter?.resolve || !providerRegistry?.invoke || typeof respond !== 'function') {
    throw new TypeError('voice_orchestrator_dependencies_required');
  }
  const sessions = new Map();

  function emit(type, details = {}) {
    onEvent(Object.freeze({ type, ...details }));
  }

  function recordFor(sessionId) {
    const record = sessions.get(sessionId);
    if (!record) throw new Error('voice_session_unknown');
    return record;
  }

  function publicStatus(record) {
    return Object.freeze({ ...record.session.status(), activated: record.activated });
  }

  function start({
    mode = 'auto',
    offline = false,
    preferredStt,
    preferredTts,
    language = 'fr',
    autoDetect = false,
    voice = 'mina-fr',
    maxSeconds = 30,
  } = {}) {
    const id = String(idFactory());
    if (sessions.has(id)) throw new Error('voice_session_duplicate');
    const record = {
      activated: false,
      mode,
      offline,
      preferredStt,
      preferredTts,
      language,
      autoDetect,
      voice,
      maxSeconds,
      session: null,
    };
    record.session = sessionFactory({
      id,
      timeoutMs: sessionTimeoutMs,
      onEvent: (event) => onEvent(event),
      onInterrupt: (event) => emit('voice_interrupted', event),
    });
    sessions.set(id, record);
    record.session.start();
    return publicStatus(record);
  }

  function route(record, capability, preferredProvider) {
    const routes = capabilityRouter.resolve({
      capability,
      mode: record.mode,
      offline: record.offline,
      preferredProvider,
    });
    if (!routes.length) throw new Error(`${capability === 'voice.transcribe' ? 'voice_stt' : 'voice_tts'}_route_unavailable`);
    return routes[0];
  }

  async function pushAudio({ sessionId, bytes, mimeType } = {}) {
    const record = recordFor(sessionId);
    const { session } = record;
    if (session.status().state !== 'listening') throw new Error('voice_session_not_listening');
    try {
      session.transition('transcribing');
      const audio = audioNormalizer({ bytes, mimeType, maxSeconds: record.maxSeconds });
      const transcript = await providerRegistry.invoke(
        route(record, 'voice.transcribe', record.preferredStt),
        { audio, language: record.language, autoDetect: record.autoDetect, signal: session.signal() },
      );
      emit('voice_transcript', {
        sessionId,
        text: transcript.text,
        language: transcript.language,
        isFinal: transcript.isFinal,
        modelId: transcript.modelId,
        usage: transcript.usage,
      });
      if (!transcript.isFinal) {
        session.transition('listening', { reason: 'partial_transcript' });
        return Object.freeze({ transcript: transcript.text, partial: true });
      }
      if (detectStopPhrase(transcript.text)) {
        session.stop('voice_stop_phrase');
        return Object.freeze({ transcript: transcript.text, stopped: true });
      }

      let command = transcript.text.trim();
      if (!record.activated) {
        const wake = detectWakePhrase(command);
        if (!wake.activated) {
          session.transition('listening', { reason: 'wake_phrase_absent' });
          return Object.freeze({ transcript: transcript.text, activated: false });
        }
        record.activated = true;
        command = wake.remainder;
        emit('voice_wake', { sessionId, phrase: wake.phrase });
        if (!command) {
          session.transition('listening', { reason: 'awaiting_command' });
          return Object.freeze({ transcript: transcript.text, activated: true });
        }
      }

      session.transition('thinking');
      emit('voice_command', { sessionId, command });
      const answer = await respond({ sessionId, command, channel: 'voice', signal: session.signal() });
      const responseText = typeof answer === 'string' ? answer : answer?.text;
      if (typeof responseText !== 'string' || !responseText.trim() || responseText.length > 10_000) {
        throw new Error('voice_response_invalid');
      }
      session.transition('speaking');
      const speech = await providerRegistry.invoke(
        route(record, 'voice.synthesize', record.preferredTts),
        { text: responseText.trim(), voice: record.voice, format: 'pcm16', signal: session.signal() },
      );
      emit('voice_audio', {
        sessionId,
        audio: speech.audio,
        mimeType: speech.mimeType,
        sampleRate: speech.sampleRate,
        isFinal: speech.isFinal,
        modelId: speech.modelId,
        usage: speech.usage,
      });
      session.transition('idle', { reason: 'completed' });
      return Object.freeze({
        transcript: transcript.text,
        response: responseText.trim(),
        audio: speech.audio,
        mimeType: speech.mimeType,
      });
    } catch (error) {
      if (error?.name === 'AbortError' && session.status().state === 'listening' && !session.status().ended) {
        return Object.freeze({ interrupted: true });
      }
      if (!session.status().ended) session.stop('failure');
      emit('voice_failure', { sessionId, reason: String(error?.message || error).slice(0, 300) });
      throw error;
    }
  }

  function stop(sessionId, reason = 'user_stop') {
    const record = recordFor(sessionId);
    record.session.stop(reason);
    return publicStatus(record);
  }

  function bargeIn(sessionId) {
    const record = recordFor(sessionId);
    record.session.bargeIn();
    emit('voice_barge_in', { sessionId });
    return publicStatus(record);
  }

  function status(sessionId) {
    return publicStatus(recordFor(sessionId));
  }

  return Object.freeze({ start, pushAudio, stop, bargeIn, status });
}
