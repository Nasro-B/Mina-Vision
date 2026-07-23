import { describe, expect, it, vi } from 'vitest';
import { createChatLedger } from '../src/devices/chat-ledger.mjs';

const memoryStore = () => {
  let saved = null;
  return {
    save: async (data) => { saved = data; },
    load: async () => (saved ? { data: saved, status: 'ok' } : { data: null, status: 'absent' }),
    saved: () => saved,
  };
};

describe('ledger des événements déjà traités', () => {
  it('ne génère qu\'une fois et resert la MÊME réponse au rejeu', async () => {
    const ledger = createChatLedger();
    const produce = vi.fn(async () => 'réponse de Mina');

    const first = await ledger.once('EVT-1', produce);
    const second = await ledger.once('EVT-1', produce);

    expect(produce).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({ answer: 'réponse de Mina', replayed: false });
    // Deux réponses différentes à la même question seraient un mensonge sur ce qui s'est passé.
    expect(second).toMatchObject({ answer: 'réponse de Mina', replayed: true });
  });

  it('deux arrivées SIMULTANÉES partagent une seule génération', async () => {
    const ledger = createChatLedger();
    let resolve;
    const produce = vi.fn(() => new Promise((r) => { resolve = r; }));

    const both = Promise.all([ledger.once('EVT-1', produce), ledger.once('EVT-1', produce)]);
    expect(ledger.inFlight()).toBe(1);
    resolve('une seule réponse');
    const [a, b] = await both;

    expect(produce).toHaveBeenCalledTimes(1);
    expect(a.answer).toBe('une seule réponse');
    expect(b.answer).toBe('une seule réponse');
    expect(ledger.inFlight()).toBe(0);
  });

  it('des événements distincts sont bien traités séparément', async () => {
    const ledger = createChatLedger();
    await ledger.once('EVT-1', async () => 'un');
    await ledger.once('EVT-2', async () => 'deux');
    expect(ledger.recall('EVT-1')).toBe('un');
    expect(ledger.recall('EVT-2')).toBe('deux');
  });

  it('survit à un redémarrage : un message redélivré n\'est pas retraité', async () => {
    const store = memoryStore();
    const first = createChatLedger({ store });
    await first.once('EVT-1', async () => 'réponse persistée');

    const second = createChatLedger({ store });
    await second.load();
    const produce = vi.fn(async () => 'nouvelle réponse');
    expect(await second.once('EVT-1', produce)).toMatchObject({ answer: 'réponse persistée', replayed: true });
    expect(produce).not.toHaveBeenCalled();
  });

  it('une génération échouée n\'est PAS mémorisée — la question reste posable', async () => {
    const ledger = createChatLedger();
    await expect(ledger.once('EVT-1', async () => { throw new Error('modèle indisponible'); }))
      .rejects.toThrow('modèle indisponible');
    expect(ledger.recall('EVT-1')).toBeNull();
    expect(await ledger.once('EVT-1', async () => 'ça marche maintenant')).toMatchObject({ answer: 'ça marche maintenant' });
  });

  it('libère la lease quand une génération traîne, sans bloquer les suivantes', async () => {
    const ledger = createChatLedger({ leaseTimeoutMs: 20 });
    await expect(ledger.once('EVT-1', () => new Promise(() => {}))).rejects.toThrow('chat_generation_trop_longue');
    expect(ledger.inFlight()).toBe(0);
  });

  it('borne sa taille — l\'entrée la plus ancienne part en premier', async () => {
    const ledger = createChatLedger({ capacity: 3 });
    for (const id of ['A', 'B', 'C', 'D']) await ledger.once(id, async () => id);
    expect(ledger.size()).toBe(3);
    expect(ledger.recall('A')).toBeNull();
    expect(ledger.recall('D')).toBe('D');
  });
});
