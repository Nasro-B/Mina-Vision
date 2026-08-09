import { describe, expect, it } from 'vitest';
import { createRealtimeChatStreamAdapter } from '../src/devices/realtime-chat-stream-adapter.mjs';

const OWNER_ID = 'owner-test';
const RESPONSE_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const CIPHERTEXT = 'AQIDBAUGBwgJCgsMDQ4PEA==';

function createControlledScheduler() {
  const tasks = [];
  return {
    schedule(callback, delayMs) {
      const task = { callback, delayMs, cancelled: false };
      tasks.push(task);
      return () => { task.cancelled = true; };
    },
    delays: () => tasks.filter((task) => !task.cancelled).map((task) => task.delayMs),
    async flushNext() {
      const task = tasks.find((candidate) => !candidate.cancelled);
      if (!task) throw new Error('scheduled_task_missing');
      task.cancelled = true;
      await task.callback();
    },
  };
}

function createRealtimeDatabase() {
  const batches = [];
  return {
    batches,
    async update(values) {
      batches.push(structuredClone(values));
    },
  };
}

describe('transport RTDB de flux de réponse Mina', () => {
  it('refuse toute identité qui n est pas le PC mina-brain', () => {
    expect(() => createRealtimeChatStreamAdapter({
      database: createRealtimeDatabase(),
      ownerIdentity: { ownerId: OWNER_ID, deviceId: 'device-samsung', isMinaBrain: false },
    })).toThrow('chat_stream_owner_identity_required');
  });

  it('refuse un prétendu ciphertext qui n est pas du Base64', () => {
    const stream = createRealtimeChatStreamAdapter({
      database: createRealtimeDatabase(),
      ownerIdentity: { ownerId: OWNER_ID, deviceId: 'mina-brain', isMinaBrain: true },
      clock: () => 1_000,
    });

    expect(() => stream.publishFrame({
      ownerId: OWNER_ID,
      responseId: RESPONSE_ID,
      sequence: 1,
      ciphertext: 'texte clair interdit',
      expiresAtMs: 2_000,
    })).toThrow('chat_stream_ciphertext_invalid');
  });

  it('refuse un Base64 non canonique que le téléphone rejetterait', () => {
    const stream = createRealtimeChatStreamAdapter({
      database: createRealtimeDatabase(),
      ownerIdentity: { ownerId: OWNER_ID, deviceId: 'mina-brain', isMinaBrain: true },
      clock: () => 1_000,
    });

    expect(() => stream.publishFrame({
      ownerId: OWNER_ID,
      responseId: RESPONSE_ID,
      sequence: 1,
      ciphertext: 'AB==',
      expiresAtMs: 2_000,
    })).toThrow('chat_stream_ciphertext_invalid');
  });

  it('refuse la trame started réservée à Firestore', () => {
    const stream = createRealtimeChatStreamAdapter({
      database: createRealtimeDatabase(),
      ownerIdentity: { ownerId: OWNER_ID, deviceId: 'mina-brain', isMinaBrain: true },
      clock: () => 1_000,
    });

    expect(() => stream.publishFrame({
      ownerId: OWNER_ID,
      responseId: RESPONSE_ID,
      sequence: 0,
      ciphertext: CIPHERTEXT,
      expiresAtMs: 2_000,
    })).toThrow('chat_stream_sequence_invalid');
  });

  it('écrit une trame chiffrée uniquement sous le chemin owner/réponse/séquence', async () => {
    const database = createRealtimeDatabase();
    const scheduler = createControlledScheduler();
    const stream = createRealtimeChatStreamAdapter({
      database,
      ownerIdentity: { ownerId: OWNER_ID, deviceId: 'mina-brain', isMinaBrain: true },
      clock: () => 1_000,
      schedule: scheduler.schedule,
    });

    const published = stream.publishFrame({
      ownerId: OWNER_ID,
      responseId: RESPONSE_ID,
      sequence: 1,
      ciphertext: CIPHERTEXT,
      expiresAtMs: 2_000,
    });

    expect(scheduler.delays()).toEqual([0]);
    await scheduler.flushNext();
    await expect(published).resolves.toMatchObject({ responseId: RESPONSE_ID, sequence: 1 });
    expect(database.batches).toEqual([{
      [`streams/${OWNER_ID}/${RESPONSE_ID}/frames/1`]: {
        ciphertext: CIPHERTEXT,
        sequence: 1,
        expiresAt: 2_000,
      },
    }]);
  });

  it('groupe les fragments arrivant dans la même fenêtre de 350 ms sans en perdre', async () => {
    let now = 0;
    const database = createRealtimeDatabase();
    const scheduler = createControlledScheduler();
    const stream = createRealtimeChatStreamAdapter({
      database,
      ownerIdentity: { ownerId: OWNER_ID, deviceId: 'mina-brain', isMinaBrain: true },
      clock: () => now,
      schedule: scheduler.schedule,
    });

    const first = stream.publishFrame({
      ownerId: OWNER_ID,
      responseId: RESPONSE_ID,
      sequence: 1,
      ciphertext: 'QUJDRA==',
      expiresAtMs: 600_000,
    });
    await scheduler.flushNext();
    await first;

    now = 100;
    const second = stream.publishFrame({
      ownerId: OWNER_ID,
      responseId: RESPONSE_ID,
      sequence: 2,
      ciphertext: 'RUZHSA==',
      expiresAtMs: 600_100,
    });
    now = 140;
    const third = stream.publishFrame({
      ownerId: OWNER_ID,
      responseId: RESPONSE_ID,
      sequence: 3,
      ciphertext: 'SUpLTA==',
      expiresAtMs: 600_140,
    });

    expect(scheduler.delays()).toEqual([250]);
    await scheduler.flushNext();
    await Promise.all([second, third]);
    expect(database.batches).toEqual([
      {
        [`streams/${OWNER_ID}/${RESPONSE_ID}/frames/1`]: {
          ciphertext: 'QUJDRA==', sequence: 1, expiresAt: 600_000,
        },
      },
      {
        [`streams/${OWNER_ID}/${RESPONSE_ID}/frames/2`]: {
          ciphertext: 'RUZHSA==', sequence: 2, expiresAt: 600_100,
        },
        [`streams/${OWNER_ID}/${RESPONSE_ID}/frames/3`]: {
          ciphertext: 'SUpLTA==', sequence: 3, expiresAt: 600_140,
        },
      },
    ]);
  });
});
