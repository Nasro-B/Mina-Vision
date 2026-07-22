// Résilience de la session Gemini Live : la voix ne doit plus se couper en pleine réponse.
// Cause racine prouvée par le journal (2026-07-21/22) : fermeture serveur de la session Live
// non gérée → audio coupé net + rafale « Session Gemini Live non connectée » sur chaque frame
// micro + récupération uniquement manuelle. Contrats testés ici :
//   1. La session déclare sessionResumption + contextWindowCompression (mécanismes officiels).
//   2. Le handle de reprise (sessionResumptionUpdate) est mémorisé et rejoué à la reconnexion.
//   3. Fermeture DISTANTE → reconnexion automatique (session_resuming → session_resumed),
//      session_end final SEULEMENT si toutes les tentatives échouent.
//   4. Pendant la reconnexion, les frames micro sont bufferisées (bornées) puis rejouées —
//      jamais l'exception en rafale.
//   5. goAway est écouté et émis (préavis serveur).
//   6. close() volontaire ne déclenche JAMAIS de reconnexion.

import { describe, expect, it, vi } from 'vitest';
import { createGeminiLiveSession } from '../src/providers/gemini-live.mjs';

function createReconnectableTransport({ failNextConnects = 0 } = {}) {
  const sessions = [];
  const state = { failNextConnects, connectCalls: [] };
  const transport = {
    connect: vi.fn(async (options) => {
      state.connectCalls.push(options);
      if (state.failNextConnects > 0) {
        state.failNextConnects -= 1;
        throw new Error('websocket_unreachable');
      }
      const session = {
        callbacks: options.callbacks,
        sendRealtimeInput: vi.fn(),
        sendClientContent: vi.fn(),
        sendToolResponse: vi.fn(),
        close: vi.fn(),
      };
      sessions.push(session);
      return session;
    }),
  };
  return {
    transport,
    state,
    sessions,
    last: () => sessions[sessions.length - 1],
    emit: (message) => sessions[sessions.length - 1].callbacks.onmessage({ message }),
    remoteClose: (index = sessions.length - 1) => sessions[index].callbacks.onclose(),
  };
}

const instantWait = async () => {};

describe('Gemini Live — reprise de session (la voix ne se coupe plus)', () => {
  it('déclare sessionResumption et contextWindowCompression dans la config de connexion', async () => {
    const fake = createReconnectableTransport();
    const live = createGeminiLiveSession({ apiKey: 'x', transport: fake.transport });
    await live.connect();
    const config = fake.state.connectCalls[0].config;
    expect(config.sessionResumption).toEqual({});
    expect(config.contextWindowCompression).toEqual({ slidingWindow: {} });
  });

  it('mémorise le handle de reprise et le rejoue lors de la reconnexion automatique', async () => {
    const fake = createReconnectableTransport();
    const events = [];
    const live = createGeminiLiveSession({
      apiKey: 'x',
      transport: fake.transport,
      reconnect: { attempts: 3, delayMs: 1, wait: instantWait },
      onEvent: (event) => events.push(event.type),
    });
    await live.connect();
    fake.emit({ sessionResumptionUpdate: { newHandle: 'handle-abc', resumable: true } });

    fake.remoteClose();
    await vi.waitFor(() => expect(live.status().connected).toBe(true));

    expect(fake.state.connectCalls).toHaveLength(2);
    expect(fake.state.connectCalls[1].config.sessionResumption).toEqual({ handle: 'handle-abc' });
    expect(events).toContain('session_resuming');
    expect(events).toContain('session_resumed');
    expect(events.filter((type) => type === 'session_end')).toHaveLength(0);
  });

  it('un handle non-resumable n\'écrase pas le dernier handle valide', async () => {
    const fake = createReconnectableTransport();
    const live = createGeminiLiveSession({
      apiKey: 'x',
      transport: fake.transport,
      reconnect: { attempts: 1, delayMs: 1, wait: instantWait },
    });
    await live.connect();
    fake.emit({ sessionResumptionUpdate: { newHandle: 'valide', resumable: true } });
    fake.emit({ sessionResumptionUpdate: { newHandle: 'transitoire', resumable: false } });
    fake.remoteClose();
    await vi.waitFor(() => expect(live.status().connected).toBe(true));
    expect(fake.state.connectCalls[1].config.sessionResumption).toEqual({ handle: 'valide' });
  });

  it('bufferise les frames micro pendant la reconnexion puis les rejoue — zéro exception en rafale', async () => {
    const fake = createReconnectableTransport();
    const errors = [];
    const live = createGeminiLiveSession({
      apiKey: 'x',
      transport: fake.transport,
      reconnect: { attempts: 3, delayMs: 1, wait: instantWait },
      onError: (error) => errors.push(error.message),
    });
    await live.connect();

    // Coupure distante en pleine réponse : le micro continue d'envoyer.
    let resolveGate;
    const gate = new Promise((resolve) => { resolveGate = resolve; });
    fake.transport.connect.mockImplementationOnce(async (options) => {
      await gate; // maintient l'état « reconnexion en cours » pendant qu'on pousse des frames
      const session = {
        callbacks: options.callbacks,
        sendRealtimeInput: vi.fn(),
        sendClientContent: vi.fn(),
        sendToolResponse: vi.fn(),
        close: vi.fn(),
      };
      fake.sessions.push(session);
      fake.state.connectCalls.push(options);
      return session;
    });
    fake.remoteClose();

    await expect(live.sendPcm16(Buffer.from([1, 2]))).resolves.toBeTruthy();
    await expect(live.sendPcm16(Buffer.from([3, 4]))).resolves.toBeTruthy();
    expect(errors).toEqual([]);

    resolveGate();
    await vi.waitFor(() => expect(live.status().connected).toBe(true));
    const replayed = fake.last().sendRealtimeInput.mock.calls.map(([input]) => input.audio.data);
    expect(replayed).toEqual([
      Buffer.from([1, 2]).toString('base64'),
      Buffer.from([3, 4]).toString('base64'),
    ]);
  });

  it('le buffer de reconnexion est borné (les plus vieilles frames tombent, jamais de croissance infinie)', async () => {
    const fake = createReconnectableTransport();
    let releaseConnect;
    const live = createGeminiLiveSession({
      apiKey: 'x',
      transport: fake.transport,
      reconnect: { attempts: 1, delayMs: 1, wait: () => new Promise((resolve) => { releaseConnect = resolve; }) },
    });
    await live.connect();
    fake.remoteClose();
    for (let index = 0; index < 80; index += 1) {
      await live.sendPcm16(Buffer.from([index, index]));
    }
    releaseConnect();
    await vi.waitFor(() => expect(live.status().connected).toBe(true));
    expect(fake.last().sendRealtimeInput.mock.calls.length).toBeLessThanOrEqual(50);
  });

  it('émet session_end UNIQUEMENT quand toutes les tentatives de reconnexion échouent, puis sendPcm16 refuse', async () => {
    const fake = createReconnectableTransport();
    const events = [];
    const live = createGeminiLiveSession({
      apiKey: 'x',
      transport: fake.transport,
      reconnect: { attempts: 2, delayMs: 1, wait: instantWait },
      onEvent: (event) => events.push(event),
    });
    await live.connect();
    fake.state.failNextConnects = 2;
    fake.remoteClose();
    await vi.waitFor(() => {
      expect(events.some((event) => event.type === 'session_end' && event.reason === 'remote_close')).toBe(true);
    });
    expect(live.status().connected).toBe(false);
    await expect(live.sendPcm16(Buffer.from([1, 2]))).rejects.toThrow(/non connectée/u);
  });

  it('écoute goAway (préavis serveur) et l\'émet avec le temps restant', async () => {
    const fake = createReconnectableTransport();
    const events = [];
    const live = createGeminiLiveSession({
      apiKey: 'x',
      transport: fake.transport,
      onEvent: (event) => events.push(event),
    });
    await live.connect();
    fake.emit({ goAway: { timeLeft: '10s' } });
    const goAway = events.find((event) => event.type === 'session_go_away');
    expect(goAway).toBeDefined();
    expect(goAway.timeLeft).toBe('10s');
  });

  it('close() volontaire ne déclenche JAMAIS de reconnexion', async () => {
    const fake = createReconnectableTransport();
    const events = [];
    const live = createGeminiLiveSession({
      apiKey: 'x',
      transport: fake.transport,
      reconnect: { attempts: 3, delayMs: 1, wait: instantWait },
      onEvent: (event) => events.push(event.type),
    });
    await live.connect();
    live.close('user_stop');
    // Certains transports rappellent onclose après un close volontaire : toujours pas de reprise.
    fake.sessions[0].callbacks.onclose();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fake.state.connectCalls).toHaveLength(1);
    expect(events.filter((type) => type === 'session_resuming')).toHaveLength(0);
  });

  it('une reconnexion réussie repart de zéro côté compteurs de reprise (nouvel handle rejouable)', async () => {
    const fake = createReconnectableTransport();
    const live = createGeminiLiveSession({
      apiKey: 'x',
      transport: fake.transport,
      reconnect: { attempts: 2, delayMs: 1, wait: instantWait },
    });
    await live.connect();
    fake.emit({ sessionResumptionUpdate: { newHandle: 'h1', resumable: true } });
    fake.remoteClose();
    await vi.waitFor(() => expect(live.status().connected).toBe(true));
    // Deuxième coupure : le handle publié par la NOUVELLE session est rejoué.
    fake.emit({ sessionResumptionUpdate: { newHandle: 'h2', resumable: true } });
    fake.remoteClose();
    await vi.waitFor(() => expect(fake.state.connectCalls.length).toBe(3));
    expect(fake.state.connectCalls[2].config.sessionResumption).toEqual({ handle: 'h2' });
  });
});
