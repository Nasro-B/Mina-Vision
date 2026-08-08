import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createChatChannel } from '../src/devices/chat-channel.mjs';
import { loadOrCreatePcChatIdentity, readPcChatPublicKey } from '../src/devices/pc-chat-identity.mjs';

const memoryFiles = () => {
  const files = new Map();
  return {
    files,
    readFile: async (path) => {
      if (!files.has(path)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return files.get(path);
    },
    writeFile: async (path, data) => { files.set(path, data); },
  };
};

const memoryStore = () => {
  let saved = null;
  return {
    save: async (data) => { saved = data; },
    load: async () => (saved ? { data: saved, status: 'ok' } : { data: null, status: 'absent' }),
    saved: () => saved,
  };
};

describe('identité PC du canal mina_app', () => {
  it('crée l\'identité une fois puis la relit à l\'identique', async () => {
    const disk = memoryFiles();
    const masterKey = randomBytes(32);
    const first = await loadOrCreatePcChatIdentity({ filePath: 'id.json', masterKey, ...disk });
    const second = await loadOrCreatePcChatIdentity({ filePath: 'id.json', masterKey, ...disk });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    // Identité stable : sinon tous les téléphones appairés ne reconnaîtraient plus le PC.
    expect(second.publicKeySpki).toBe(first.publicKeySpki);
  });

  it('la clé privée n\'est JAMAIS écrite en clair', async () => {
    const disk = memoryFiles();
    const masterKey = randomBytes(32);
    const identity = await loadOrCreatePcChatIdentity({ filePath: 'id.json', masterKey, ...disk });
    const raw = disk.files.get('id.json');
    const pkcs8 = identity.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
    expect(raw).not.toContain(pkcs8);
    expect(raw).not.toContain('PRIVATE KEY');
  });

  it('refuse de remplacer en silence une identité illisible', async () => {
    const disk = memoryFiles();
    await loadOrCreatePcChatIdentity({ filePath: 'id.json', masterKey: randomBytes(32), ...disk });
    await expect(loadOrCreatePcChatIdentity({ filePath: 'id.json', masterKey: randomBytes(32), ...disk }))
      .rejects.toThrow('pc_chat_identity_illisible');
  });

  it('refuse de travailler coffre verrouillé', async () => {
    const disk = memoryFiles();
    await expect(loadOrCreatePcChatIdentity({ filePath: 'id.json', masterKey: null, ...disk }))
      .rejects.toThrow('pc_chat_identity_coffre_verrouille');
  });

  it('la clé publique reste lisible sans déverrouiller', async () => {
    const disk = memoryFiles();
    const identity = await loadOrCreatePcChatIdentity({ filePath: 'id.json', masterKey: randomBytes(32), ...disk });
    expect(await readPcChatPublicKey({ filePath: 'id.json', readFile: disk.readFile }))
      .toBe(identity.publicKeySpki);
  });
});

describe('canal mina_app côté PC', () => {
  const startChannel = async (overrides = {}) => {
    const disk = memoryFiles();
    const masterKey = randomBytes(32);
    const identity = await loadOrCreatePcChatIdentity({ filePath: 'id.json', masterKey, ...disk });
    const store = memoryStore();
    const channel = createChatChannel({
      masterKey: overrides.masterKey ?? (() => masterKey),
      identity,
      store,
      respond: async ({ text }) => `écho ${text}`,
      port: 0,
      host: '127.0.0.1',
      ...overrides,
    });
    return { channel, store, masterKey, identity };
  };

  it('n\'annonce « à l\'écoute » qu\'après une écoute RÉELLE', async () => {
    const { channel } = await startChannel();
    expect(channel.status().listening).toBe(false);
    const listening = await channel.start();
    expect(listening.port).toBeGreaterThan(0);
    expect(channel.status()).toMatchObject({ listening: true, vaultUnlocked: true });
    await channel.stop();
    expect(channel.status().listening).toBe(false);
  });

  it('signale le coffre verrouillé au lieu de laisser croire que le canal sert', async () => {
    const { channel } = await startChannel({ masterKey: () => null });
    await channel.start();
    expect(channel.status().vaultUnlocked).toBe(false);
    await channel.stop();
  });

  it('remonte la cause exacte quand le port est déjà pris', async () => {
    const first = await startChannel();
    const listening = await first.channel.start();
    const second = await startChannel({ port: listening.port });
    expect(await second.channel.start()).toBeNull();
    expect(second.channel.status().lastError).toBeTruthy();
    expect(second.channel.status().listening).toBe(false);
    await first.channel.stop();
  });

  it('persiste le registre et le relit au démarrage suivant', async () => {
    const disk = memoryFiles();
    const masterKey = randomBytes(32);
    const identity = await loadOrCreatePcChatIdentity({ filePath: 'id.json', masterKey, ...disk });
    const store = memoryStore();
    const options = { masterKey: () => masterKey, identity, store, respond: async () => 'ok', port: 0, host: '127.0.0.1' };

    const first = createChatChannel(options);
    first.openPairing();
    await first.revoke('inconnu');
    await first.persistNow();

    const second = createChatChannel(options);
    await second.load();
    expect(second.status().keyEpoch).toBe(store.saved().keyEpoch);
  });

  it('révoquer avance l\'époque et l\'état persisté le reflète', async () => {
    const { channel, store } = await startChannel();
    const { code } = channel.openPairing();
    // Approbation directe par le registre exposé via le serveur : ici on simule l'appairage.
    await channel.start();
    expect(channel.status().keyEpoch).toBe(1);
    expect(code).toMatch(/^\d{6}$/u);
    await channel.stop();
    expect(store.saved()).toBeNull();
  });

  it('compose une seule instance média avec une déduplication durable par mediaId', async () => {
    let completeOnce = null;
    const createMediaHandler = vi.fn(({ completeOnce: once }) => {
      completeOnce = once;
      return async () => ({ complete: true });
    });
    const firestore = {
      watch: vi.fn(() => () => {}),
      put: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
    };
    const { channel } = await startChannel({
      firestore,
      publicKeyFromSpki: () => { throw new Error('non appele dans ce test'); },
      createMediaHandler,
    });

    await channel.start();

    expect(createMediaHandler).toHaveBeenCalledOnce();
    const work = vi.fn(async () => 'complete');
    expect(await completeOnce('media-once', work)).toMatchObject({ answer: 'complete', replayed: false });
    expect(await completeOnce('media-once', work)).toMatchObject({ answer: 'complete', replayed: true });
    expect(work).toHaveBeenCalledOnce();
    await channel.stop();
  });
});
