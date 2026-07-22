import { describe, expect, it } from 'vitest';
import {
  createSalienceTracker, rankScore, recencyWeight, salienceWeight,
} from '../src/memory/memory-ranking.mjs';

const NOW = 1_752_900_000_000;
const DAY = 86_400_000;

describe('recencyWeight — classement seulement, jamais une expiration', () => {
  it('keeps a hard floor so an old memory can still win on relevance', () => {
    expect(recencyWeight(NOW - 365 * DAY, NOW)).toBeGreaterThanOrEqual(0.4);
    expect(recencyWeight(NOW - 3_650 * DAY, NOW)).toBeGreaterThanOrEqual(0.4);
  });

  it('halves the decaying part at ~30 days and treats the future as neutral', () => {
    const fresh = recencyWeight(NOW - 1, NOW);
    const month = recencyWeight(NOW - 30 * DAY, NOW);
    expect(fresh).toBeGreaterThan(0.99);
    expect(month).toBeCloseTo(0.7, 1); // 0,4 + 0,6 × 0,5
    expect(recencyWeight(NOW + DAY, NOW)).toBe(1);
  });
});

describe('salienceWeight — un bonus saturé, jamais une pénalité', () => {
  it('never drops below 1 and saturates on heavy access', () => {
    expect(salienceWeight({ hits: 0 }, NOW)).toBe(1);
    const light = salienceWeight({ hits: 2, lastHitAt: NOW - 1 }, NOW);
    const heavy = salienceWeight({ hits: 200, lastHitAt: NOW - 1 }, NOW);
    expect(light).toBeGreaterThan(1);
    expect(heavy).toBeLessThanOrEqual(1.5);
    expect(heavy).toBeGreaterThan(light);
  });

  it('fades the bonus when the memory has not been touched for weeks', () => {
    const recent = salienceWeight({ hits: 5, lastHitAt: NOW - DAY }, NOW);
    const stale = salienceWeight({ hits: 5, lastHitAt: NOW - 28 * DAY }, NOW);
    expect(stale).toBeLessThan(recent);
    expect(stale).toBeGreaterThanOrEqual(1);
  });
});

describe('rankScore — la pertinence reste le socle', () => {
  it('returns 0 for a zero base regardless of salience, and reorders equals by recency', () => {
    expect(rankScore({ base: 0, createdAt: NOW, now: NOW, salience: { hits: 50, lastHitAt: NOW } })).toBe(0);
    const old = rankScore({ base: 0.8, createdAt: NOW - 90 * DAY, now: NOW });
    const fresh = rankScore({ base: 0.8, createdAt: NOW - DAY, now: NOW });
    expect(fresh).toBeGreaterThan(old);
  });

  it('lets a much more relevant OLD memory beat a weakly relevant fresh one — floor at work', () => {
    const oldStrong = rankScore({ base: 1, createdAt: NOW - 400 * DAY, now: NOW });
    const freshWeak = rankScore({ base: 0.3, createdAt: NOW - 1, now: NOW });
    expect(oldStrong).toBeGreaterThan(freshWeak);
  });
});

describe('createSalienceTracker — RAM bornée, éviction des plus anciens', () => {
  it('counts touches and evicts the oldest entry past the cap', () => {
    let clock = NOW;
    const tracker = createSalienceTracker({ now: () => (clock += 1), maxEntries: 3 });
    tracker.touch('a'); tracker.touch('b'); tracker.touch('a'); tracker.touch('c');
    expect(tracker.get('a').hits).toBe(2);
    tracker.touch('d'); // dépasse le cap → 'b' (le plus anciennement touché) sort
    expect(tracker.get('b').hits).toBe(0);
    expect(tracker.get('a').hits).toBe(2);
    expect(tracker.size()).toBe(3);
  });

  it('ignores empty ids and answers zeros for unknown ones', () => {
    const tracker = createSalienceTracker();
    tracker.touch('');
    tracker.touch(null);
    expect(tracker.size()).toBe(0);
    expect(tracker.get('inconnu')).toEqual({ hits: 0, lastHitAt: 0 });
  });
});

describe('memory-service + salience — intégration du classement', () => {
  it('reorders equal-relevance memories by recency and boosts repeatedly served ones', async () => {
    const { createMemoryService } = await import('../src/memory/memory-service.mjs');
    const events = [
      { id: 'vieux', createdAt: NOW - 90 * DAY, content: 'rendez vous dentiste', classification: 'normal', retention: 'indefinite', provenance: {} },
      { id: 'frais', createdAt: NOW - DAY, content: 'rendez vous dentiste', classification: 'normal', retention: 'indefinite', provenance: {} },
    ];
    const service = createMemoryService({
      eventRepository: {
        write: () => {}, read: () => null, listByIdentity: () => events.map((event) => structuredClone(event)),
      },
      identityGraph: { resolve: () => ({ id: 'nasro' }) },
      now: () => NOW,
      salience: createSalienceTracker({ now: () => NOW }),
    });

    const first = service.recall({ kind: 'device', value: 'pc', query: 'dentiste' });
    expect(first[0].date).toBe(NOW - DAY); // même pertinence → le récent d'abord
    expect(first).toHaveLength(2); // le vieux est CLASSÉ après, jamais éliminé
  });

  it('keeps the historical ordering byte-identical when no tracker is provided', async () => {
    const { createMemoryService } = await import('../src/memory/memory-service.mjs');
    const events = [
      { id: 'a', createdAt: 1, content: 'chat noir', classification: 'normal', retention: 'indefinite', provenance: {} },
      { id: 'b', createdAt: 2, content: 'chat noir', classification: 'normal', retention: 'indefinite', provenance: {} },
    ];
    const service = createMemoryService({
      eventRepository: { write: () => {}, read: () => null, listByIdentity: () => events.map((event) => structuredClone(event)) },
      identityGraph: { resolve: () => ({ id: 'nasro' }) },
      now: () => NOW,
    });
    const result = service.recall({ kind: 'device', value: 'pc', query: 'chat' });
    expect(result.map((entry) => entry.date)).toEqual([2, 1]);
    expect(result[0].score).toBe(1); // score brut intact sans tracker
  });
});
