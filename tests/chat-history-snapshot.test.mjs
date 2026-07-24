import { describe, it, expect } from 'vitest';
import { createChatHistorySnapshot } from '../src/devices/chat-history-snapshot.mjs';

const clock = () => 1_784_800_000_000;

describe('createChatHistorySnapshot', () => {
  it('exige la mémoire (recentConversation)', () => {
    expect(() => createChatHistorySnapshot({})).toThrow('chat_history_snapshot_memory_required');
  });

  it('capture : entrées réelles bornées + état réel du canal, rien d’inventé', async () => {
    const snapshotter = createChatHistorySnapshot({
      memory: {
        recentConversation: async ({ limit }) => Array.from({ length: Math.min(3, limit) }, (_, i) => ({
          content: `Nasro : message ${i}`, date: 1_784_700_000_000 + i,
        })),
        status: () => ({ locked: false }),
      },
      channel: { status: () => ({ listening: true, keyEpoch: 4, connectedDevices: ['device-samsung'], processedEvents: 12 }) },
      clock,
    });
    const snapshot = await snapshotter.capture({ limit: 10 });
    expect(snapshot.version).toBe(1);
    expect(snapshot.capturedAtMs).toBe(clock());
    expect(snapshot.entryCount).toBe(3);
    expect(snapshot.memoryLocked).toBe(false);
    expect(snapshot.entries[0].content).toBe('Nasro : message 0');
    expect(snapshot.channel).toEqual({ listening: true, keyEpoch: 4, connectedDevices: ['device-samsung'], processedEvents: 12 });
  });

  it('coffre verrouillé : memoryLocked=true, entries vide — jamais un historique deviné', async () => {
    const snapshotter = createChatHistorySnapshot({
      memory: {
        recentConversation: async () => { throw new Error('memory_locked'); },
        status: () => ({ locked: true }),
      },
      clock,
    });
    const snapshot = await snapshotter.capture();
    expect(snapshot.memoryLocked).toBe(true);
    expect(snapshot.entries).toEqual([]);
    expect(await snapshotter.brief()).toContain('coffre verrouillé');
  });

  it('brief : lignes jointes, bornées à ~4 Ko ; vide dit « aucun échange »', async () => {
    const long = 'x'.repeat(300);
    const snapshotter = createChatHistorySnapshot({
      memory: {
        recentConversation: async ({ limit }) => Array.from({ length: limit }, () => ({ content: long, date: 1 })),
        status: () => ({ locked: false }),
      },
      clock,
    });
    expect((await snapshotter.brief({ limit: 50 })).length).toBeLessThanOrEqual(4_096);

    const empty = createChatHistorySnapshot({
      memory: { recentConversation: async () => [], status: () => ({ locked: false }) },
      clock,
    });
    expect(await empty.brief()).toContain('Aucun échange');
  });

  it('borne limit à [1, 200]', async () => {
    let asked = null;
    const snapshotter = createChatHistorySnapshot({
      memory: { recentConversation: async ({ limit }) => { asked = limit; return []; }, status: () => ({ locked: false }) },
      clock,
    });
    await snapshotter.capture({ limit: 9_999 });
    expect(asked).toBe(200);
    await snapshotter.capture({ limit: -5 });
    expect(asked).toBe(1); // plancher du clamp
    await snapshotter.capture({ limit: 'abc' });
    expect(asked).toBe(50); // non numérique => défaut
  });
});
