import { describe, expect, it, vi } from 'vitest';
import { decodeAssistantResponseFrame } from '../src/contracts/assistant-response-stream.mjs';
import { createChatLedger } from '../src/devices/chat-ledger.mjs';
import { createChatResponseStream } from '../src/devices/chat-response-stream.mjs';

const RESPONSE_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const SOURCE_EVENT_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const input = Object.freeze({
  sourceEventId: SOURCE_EVENT_ID,
  text: 'bonjour',
  deviceId: 'device-samsung',
  threadId: 'thread-main',
});

function memoryStore(initial = null) {
  let saved = initial === null ? null : structuredClone(initial);
  const snapshots = [];
  return {
    save: async (data) => {
      saved = structuredClone(data);
      snapshots.push(structuredClone(data));
    },
    load: async () => (saved ? { data: structuredClone(saved), status: 'ok' } : { data: null, status: 'absent' }),
    saved: () => structuredClone(saved),
    snapshots: () => structuredClone(snapshots),
  };
}

function collector(store) {
  const frames = [];
  return {
    frames,
    emit: async (frame) => {
      const decoded = decodeAssistantResponseFrame(frame.payload);
      if (decoded.type === 'assistant.response.chunk') {
        expect(store.saved().entries[0].chunks).toContain(decoded.text);
      }
      frames.push({ ...frame, decoded });
    },
  };
}

describe('réponse chat progressive durable', () => {
  it('persiste chaque fragment avant émission puis resert la même séquence sans regénérer', async () => {
    const store = memoryStore();
    const ledger = createChatLedger({ store, clock: () => 700 });
    let releaseAnswer;
    const firstChunkPersisted = new Promise((resolve) => { releaseAnswer = resolve; });
    const respond = vi.fn(async ({ onDelta }) => {
      await onDelta('bon');
      await firstChunkPersisted;
      await onDelta('jour');
      return 'bonjour';
    });
    const stream = createChatResponseStream({
      ledger,
      respond,
      makeResponseId: vi.fn(() => RESPONSE_ID),
    });
    const captured = collector(store);

    const first = stream.deliver(input, captured.emit);
    await vi.waitFor(() => expect(respond).toHaveBeenCalledTimes(1));
    const replay = stream.deliver(input, captured.emit);
    releaseAnswer();
    const [firstResult, replayResult] = await Promise.all([first, replay]);

    expect(firstResult).toMatchObject({ answer: 'bonjour', chunks: ['bon', 'jour'], replayed: false });
    expect(replayResult).toMatchObject({ answer: 'bonjour', chunks: ['bon', 'jour'], replayed: true });
    expect(respond).toHaveBeenCalledTimes(1);
    expect(captured.frames.map(({ decoded }) => decoded.type)).toEqual([
      'assistant.response.started', 'assistant.response.chunk', 'assistant.response.chunk', 'assistant.response.completed',
      'assistant.response.started', 'assistant.response.chunk', 'assistant.response.chunk', 'assistant.response.completed',
    ]);
    expect(captured.frames.map(({ decoded }) => decoded.sequence)).toEqual([0, 1, 2, 3, 0, 1, 2, 3]);
    expect(captured.frames.map(({ routingClass }) => routingClass)).toEqual([
      'stream', 'stream', 'stream', 'message', 'stream', 'stream', 'stream', 'message',
    ]);
    expect(store.saved()).toEqual({
      schemaVersion: 2,
      entries: [{ eventId: SOURCE_EVENT_ID, responseId: RESPONSE_ID, chunks: ['bon', 'jour'], answer: 'bonjour', atMs: 700 }],
    });
  });

  it('migre un ancien résultat final et le rejoue avec un nouvel identifiant sans appeler le modèle', async () => {
    const store = memoryStore({ entries: [{ eventId: SOURCE_EVENT_ID, answer: 'bonjour', atMs: 41 }] });
    const ledger = createChatLedger({ store, clock: () => 800 });
    await ledger.load();
    const respond = vi.fn(async () => 'ne doit pas être appelé');
    const stream = createChatResponseStream({
      ledger,
      respond,
      makeResponseId: () => RESPONSE_ID,
    });
    const captured = collector(store);

    const replay = await stream.deliver(input, captured.emit);

    expect(replay).toMatchObject({ responseId: RESPONSE_ID, chunks: [], answer: 'bonjour', replayed: true });
    expect(respond).not.toHaveBeenCalled();
    expect(captured.frames.map(({ decoded }) => decoded.type)).toEqual([
      'assistant.response.started', 'assistant.response.completed',
    ]);
    expect(store.saved()).toEqual({
      schemaVersion: 2,
      entries: [{ eventId: SOURCE_EVENT_ID, responseId: RESPONSE_ID, chunks: [], answer: 'bonjour', atMs: 41 }],
    });
  });

  it('rejoue un stream terminé après redémarrage sans régénérer la réponse', async () => {
    const store = memoryStore();
    const first = createChatResponseStream({
      ledger: createChatLedger({ store, clock: () => 900 }),
      respond: async ({ onDelta }) => {
        await onDelta('bon');
        await onDelta('jour');
        return 'bonjour';
      },
      makeResponseId: () => RESPONSE_ID,
    });
    await first.deliver(input, async () => {});

    const restartedLedger = createChatLedger({ store, clock: () => 1_000 });
    await restartedLedger.load();
    const respond = vi.fn(async () => 'ne doit pas être appelé');
    const makeResponseId = vi.fn(() => '01ARZ3NDEKTSV4RRFFQ69G5FAX');
    const replay = createChatResponseStream({ ledger: restartedLedger, respond, makeResponseId });
    const captured = collector(store);

    const result = await replay.deliver(input, captured.emit);

    expect(result).toMatchObject({ responseId: RESPONSE_ID, chunks: ['bon', 'jour'], answer: 'bonjour', replayed: true });
    expect(respond).not.toHaveBeenCalled();
    expect(makeResponseId).not.toHaveBeenCalled();
    expect(captured.frames.map(({ decoded }) => decoded.type)).toEqual([
      'assistant.response.started', 'assistant.response.chunk', 'assistant.response.chunk', 'assistant.response.completed',
    ]);
  });

  it('n’invente aucun fragment lorsqu’un fournisseur ne fournit qu’une réponse finale', async () => {
    const store = memoryStore();
    const stream = createChatResponseStream({
      ledger: createChatLedger({ store }),
      respond: async () => 'réponse finale seulement',
      makeResponseId: () => RESPONSE_ID,
    });
    const captured = collector(store);

    await stream.deliver(input, captured.emit);

    expect(captured.frames.map(({ decoded }) => decoded.type)).toEqual([
      'assistant.response.started', 'assistant.response.completed',
    ]);
  });

  it('n’émet aucun chunk lorsque sa persistance échoue', async () => {
    let saveCount = 0;
    let saved = null;
    const store = {
      save: async (data) => {
        saveCount += 1;
        if (saveCount === 2) throw new Error('disque indisponible');
        saved = structuredClone(data);
      },
      load: async () => ({ data: null, status: 'absent' }),
      saved: () => structuredClone(saved),
    };
    const stream = createChatResponseStream({
      ledger: createChatLedger({ store }),
      respond: async ({ onDelta }) => {
        await onDelta('bon');
        return 'bon';
      },
      makeResponseId: () => RESPONSE_ID,
    });
    const frames = [];

    await expect(stream.deliver(input, async (frame) => frames.push(frame))).rejects.toThrow('chat_ledger_persistance_echouee');

    expect(frames.map(({ type }) => type)).toEqual([
      'assistant.response.started', 'assistant.response.failed',
    ]);
    expect(frames.some(({ type }) => type === 'assistant.response.chunk')).toBe(false);
  });
});
