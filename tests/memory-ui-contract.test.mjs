import { describe, expect, it, vi } from 'vitest';
import { createMemoryRuntimeController } from '../src/memory/runtime-controller.mjs';
import { createEvidenceValidator } from '../src/grounding/evidence-validator.mjs';

const recalled = Object.freeze({
  content: 'Rendez-vous mardi à 14 h',
  score: 0.9,
  provenance: { source: 'sms', deviceId: 'huawei' },
  date: Date.parse('2026-07-15T10:00:00.000Z'),
  classification: 'normal',
  retention: 'indefinite',
});

function harness({ confirmed = true } = {}) {
  const memoryService = { recall: vi.fn(() => [recalled]), remember: vi.fn((input) => ({ id: input.eventId })) };
  const forgetService = {
    proposeForget: vi.fn(() => ({ id: 'proposal-1', status: 'awaiting_local_confirmation' })),
    confirmForget: vi.fn(() => ({ deleted: 1, backupPending: 1 })),
  };
  const researchService = {
    readFile: vi.fn(async () => ({
      evidence: [{ sourceId: 'file-1', locator: 'C:\\Docs\\note.txt:1', capturedAt: '2026-07-15T11:00:00.000Z', contentDigest: `sha256:${'a'.repeat(64)}`, freshnessClass: 'current', extract: 'preuve fichier', method: 'utf8_text' }],
      result: { path: 'C:\\Docs\\note.txt' },
    })),
    readWeb: vi.fn(async () => ({ evidence: [], result: { finalUrl: 'https://example.test/' } })),
  };
  return {
    memoryService,
    forgetService,
    researchService,
    controller: createMemoryRuntimeController({
      keyring: { open: vi.fn(async () => Buffer.alloc(32, 7)) },
      buildServices: vi.fn(async () => ({ memoryService, forgetService, researchService, semanticMode: 'lexical_degraded', backupState: 'disabled' })),
      confirmLocal: vi.fn(async () => confirmed),
    }),
  };
}

describe('memory and research UI contract', () => {
  it('uses semantic recall when the local embedding runtime is active', async () => {
    const memoryService = {
      recall: vi.fn(() => []),
      recallSemantic: vi.fn(async () => [recalled]),
      remember: vi.fn(),
    };
    const controller = createMemoryRuntimeController({
      keyring: { open: vi.fn(async () => Buffer.alloc(32, 7)) },
      buildServices: vi.fn(async () => ({
        memoryService,
        forgetService: { proposeForget: vi.fn(), confirmForget: vi.fn() },
        researchService: { readFile: vi.fn(), readWeb: vi.fn() },
        semanticMode: 'semantic_local',
        backupState: 'disabled',
      })),
    });
    await controller.unlock();

    await expect(controller.search({ query: 'rendez-vous' })).resolves.toMatchObject({
      semanticMode: 'semantic_local', items: [expect.objectContaining({ content: recalled.content })],
    });
    expect(memoryService.recallSemantic).toHaveBeenCalled();
    expect(memoryService.recall).not.toHaveBeenCalled();
  });

  it('retries a TRANSIENT DPAPI wrap failure at auto-unlock, then succeeds without a phrase', async () => {
    // Le démarrage au login peut rendre le wrap momentanément indéchiffrable ; l'auto-unlock
    // réessaie et finit déverrouillé sans jamais demander la phrase.
    const open = vi.fn()
      .mockRejectedValueOnce(new Error('keyring_wrapped_key_undecryptable: le chiffrement Windows a changé'))
      .mockRejectedValueOnce(new Error('keyring_wrapped_key_undecryptable: le chiffrement Windows a changé'))
      .mockResolvedValue(Buffer.alloc(32, 7));
    const controller = createMemoryRuntimeController({
      keyring: { open, openWithRecovery: vi.fn() },
      buildServices: vi.fn(async () => ({
        memoryService: { recall: vi.fn(() => []), remember: vi.fn() },
        forgetService: { proposeForget: vi.fn(), confirmForget: vi.fn() },
        researchService: { readFile: vi.fn(), readWeb: vi.fn() },
        semanticMode: 'lexical_degraded', backupState: 'disabled',
      })),
      autoUnlockDelayMs: 0,
      sleep: vi.fn(async () => {}),
    });

    await expect(controller.unlock()).resolves.toMatchObject({ locked: false });
    expect(open).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry a bad recovery phrase and does NOT retry a structural buildServices failure', async () => {
    // Phrase erronée = définitive : un seul essai.
    const badPhrase = createMemoryRuntimeController({
      keyring: { open: vi.fn(), openWithRecovery: vi.fn(async () => { throw new Error('invalid_recovery_phrase'); }) },
      buildServices: vi.fn(async () => ({})),
    });
    await expect(badPhrase.unlock({ recoveryPhrase: 'mauvaise phrase' })).rejects.toThrow('invalid_recovery_phrase');

    // Échec structurel (pas le wrap) = pas de retry, échec immédiat.
    const structural = vi.fn(async () => Buffer.alloc(32, 7));
    const brokenServices = createMemoryRuntimeController({
      keyring: { open: structural, openWithRecovery: vi.fn() },
      buildServices: vi.fn(async () => ({ memoryService: {} })), // manque recall → memory_services_unavailable
      sleep: vi.fn(async () => {}),
    });
    await expect(brokenServices.unlock()).rejects.toThrow('memory_services_unavailable');
    expect(structural).toHaveBeenCalledTimes(1);
  });

  it('fails closed while locked, unlocks without exposing the key, and masks sensitive recall', async () => {
    const { controller, memoryService } = harness();
    expect(controller.status()).toEqual({ locked: true, semanticMode: 'unavailable', backupState: 'disabled', researchEvidence: 0 });
    await expect(controller.search({ query: 'mardi' })).rejects.toThrow('memory_locked');

    await expect(controller.unlock()).resolves.toEqual({ locked: false, semanticMode: 'lexical_degraded', backupState: 'disabled', researchEvidence: 0 });
    const result = await controller.search({ query: 'mardi', revealSensitive: false });
    expect(memoryService.recall).toHaveBeenCalledWith({ kind: 'local_owner', value: 'owner', query: 'mardi', revealSensitive: false });
    expect(result.items[0]).toMatchObject({ content: recalled.content, provenance: recalled.provenance, classification: 'normal', masked: false });
    expect(result.masterKey).toBeUndefined();

    controller.lock();
    await expect(controller.missionEvidence({ goal: 'Mon rendez-vous', memoryRequired: true })).rejects.toThrow('memory_locked');
  });

  it('returns referenced evidence separately from the mission goal and retains selected research evidence', async () => {
    const { controller } = harness();
    await controller.unlock();
    await controller.readFile({ path: 'C:\\Docs\\note.txt' });

    const evidence = await controller.missionEvidence({ goal: 'Quand est mon rendez-vous ?', memoryRequired: true });
    expect(evidence.map(({ sourceId }) => sourceId)).toEqual(['memory-50761dbdb16f87430a42', 'file-1']);
    expect(evidence[0]).toMatchObject({ locator: 'memory://owner/2026-07-15T10%3A00%3A00.000Z', extract: recalled.content, method: 'document' });
    expect(evidence.some((item) => item.extract.includes('Quand est mon rendez-vous ?'))).toBe(false);
    expect(controller.status().researchEvidence).toBe(1);
  });

  it('memory-recall evidence passes the real evidence-validator schema (method must be a valid enum value)', async () => {
    const { controller } = harness();
    await controller.unlock();
    const [memoryItem] = await controller.missionEvidence({ goal: 'Quand est mon rendez-vous ?', memoryRequired: true });

    const validator = createEvidenceValidator();
    const verdict = validator.validate({ evidenceIds: [memoryItem.sourceId], claimType: 'inference' }, [memoryItem]);
    expect(verdict.reasons.some((reason) => reason.startsWith('invalid_evidence'))).toBe(false);
  });

  it('confirms forget locally in the main-process controller before deletion', async () => {
    const allowed = harness({ confirmed: true });
    await allowed.controller.unlock();
    await expect(allowed.controller.proposeForget({ criteria: { subject: 'rendez-vous' } }))
      .resolves.toEqual({ deleted: 1, backupPending: 1 });
    expect(allowed.forgetService.confirmForget).toHaveBeenCalledWith({ proposalId: 'proposal-1', confirmedLocally: true });

    const refused = harness({ confirmed: false });
    await refused.controller.unlock();
    await expect(refused.controller.proposeForget({ criteria: { subject: 'rendez-vous' } })).rejects.toThrow('local_forget_confirmation_refused');
    expect(refused.forgetService.confirmForget).not.toHaveBeenCalled();
  });

  it('normalizes a phone message into a deterministic sensitive memory event', async () => {
    const { controller, memoryService } = harness();
    await controller.unlock();

    await expect(controller.rememberRemoteMessage({
      id: 'opaque-1', channel: 'sms', sender: '+33600000000',
      body: 'Bonjour Mina', sentAtMs: 2_000, deviceId: 'huawei-primary',
    })).resolves.toMatchObject({ duplicateSafe: true, channel: 'sms', messageId: 'opaque-1' });

    expect(memoryService.remember).toHaveBeenCalledWith(expect.objectContaining({
      eventId: `phone-${'4e2e74e3ab1ccc34af1eae3a68bf8feceee1f901b0b43a9aee1852e32326056e'}`,
      kind: 'local_owner', value: 'owner', channel: 'sms',
      content: 'De +33600000000 : Bonjour Mina', classification: 'sensitive',
      provenance: {
        messageId: 'opaque-1', sender: '+33600000000', deviceId: 'huawei-primary', sentAtMs: 2_000,
      },
    }));
  });
});

describe('conversation vocale durable — mémoire des sessions entre redémarrages', () => {
  it('remembers owner and Mina utterances on the voice channel with provenance', async () => {
    const { controller, memoryService } = harness();
    await controller.unlock();

    await controller.rememberUtterance({ role: 'owner', text: '  mets la musique   de Cheb Hasni ' });
    await controller.rememberUtterance({ role: 'mina', text: 'Je lance YouTube.', engine: 'gemini' });

    expect(memoryService.remember).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'voice',
      content: 'Nasro : mets la musique de Cheb Hasni',
      classification: 'normal',
      provenance: expect.objectContaining({ source: 'voice', role: 'owner' }),
    }));
    expect(memoryService.remember).toHaveBeenCalledWith(expect.objectContaining({
      content: 'Mina : Je lance YouTube.',
      provenance: expect.objectContaining({ role: 'mina', engine: 'gemini' }),
    }));
  });

  it('refuses empty utterances and requires the vault for writes', async () => {
    const { controller } = harness();
    await controller.unlock();
    await expect(controller.rememberUtterance({ role: 'owner', text: '   ' })).rejects.toThrow('utterance_invalid');

    const locked = harness().controller;
    await expect(locked.rememberUtterance({ role: 'owner', text: 'bonjour' })).rejects.toThrow('memory_locked');
  });

  it('returns the recent conversation chronologically, voice-only, and is SILENT when locked', async () => {
    const voiceItem = (content, date, role = 'owner') => ({
      content, score: 1, date, classification: 'normal', retention: 'indefinite',
      provenance: { source: 'voice', role },
    });
    const memoryService = {
      recall: vi.fn(() => [
        voiceItem('Nasro : premier échange', 1_000),
        { ...voiceItem('SMS privé', 3_000), provenance: { source: 'sms' } },
        voiceItem('Mina : je m en occupe', 2_000, 'mina'),
        { ...voiceItem('Nasro : code secret', 4_000), classification: 'secret' },
      ]),
      remember: vi.fn(),
    };
    const controller = createMemoryRuntimeController({
      keyring: { open: vi.fn(async () => Buffer.alloc(32, 7)) },
      buildServices: vi.fn(async () => ({
        memoryService,
        forgetService: { proposeForget: vi.fn(), confirmForget: vi.fn() },
        researchService: { readFile: vi.fn(), readWeb: vi.fn() },
        semanticMode: 'lexical_degraded', backupState: 'disabled',
      })),
    });

    await expect(controller.recentConversation()).resolves.toEqual([]); // verrouillé → silencieux

    await controller.unlock();
    const conversation = await controller.recentConversation({ limit: 5 });
    expect(conversation.map((item) => item.content)).toEqual([
      'Nasro : premier échange', 'Mina : je m en occupe',
    ]); // chronologique, SMS exclu, secret exclu
  });
});

describe('conversation memory wiring contract — sessions survive restarts', () => {
  it('names the app, remembers every spoken turn on all three mouths and both ears, and reinjects context', async () => {
    const { readFile } = await import('node:fs/promises');
    const main = await readFile('src/ui/main.mjs', 'utf8');
    const live = await readFile('src/providers/gemini-live.mjs', 'utf8');

    // Named userData while the vault does not exist yet — after, migration would be perilous.
    expect(main).toContain("app.setName('Mina Vision')");
    expect(main).toMatch(/app\.setPath\('userData', namedUserData\)/u);

    // Owner utterances (both ears), Mina replies (Gemini free speech, [DIS], Kokoro).
    expect(main).toMatch(/rememberSpokenTurn\('owner', utterance, engine\)/u);
    expect(main).toContain("buildUtteranceRoute('gemini')");
    expect(main).toContain("buildUtteranceRoute('deepgram')");
    expect(main).toMatch(/rememberSpokenTurn\('mina', line, 'dis'\)/u);
    expect(main).toMatch(/rememberSpokenTurn\('mina', spoken, 'gemini'\)/u);
    expect(main).toMatch(/rememberSpokenTurn\('mina', text, 'kokoro'\)/u);

    // Fail-soft: memory writes may never break the voice.
    expect(main).toMatch(/rememberUtterance\(\{ role, text, engine \}\)\.catch\(\(\) => \{\}\)/u);

    // Context resumption injected into the live instruction, empty when locked.
    expect(main).toContain('recentConversation({ limit: 20 })');
    expect(main).toMatch(/conversationBrief,/u);
    expect(main).toMatch(/\.filter\(Boolean\)\.join\(' '\)/u);

    // The live session now surfaces what MINA says, with turn boundaries.
    expect(live).toContain('onModelTranscript');
    expect(live).toMatch(/outputTranscription\?\.text/u);
  });

  it('does NOT require the vault by default — strict blocking is an explicit opt-in', async () => {
    const { readFile } = await import('node:fs/promises');
    const html = await readFile('src/ui/index.html', 'utf8');
    // Regression: the checkbox shipped CHECKED while no vault existed yet — every browser mission
    // died on memory_locked before a single action. Memory is used whenever available anyway;
    // this box only adds the strict block, so it must start unchecked.
    const checkbox = html.match(/<input id="memory-required"[^>]*>/u)?.[0];
    expect(checkbox).toBeTruthy();
    expect(checkbox).not.toContain('checked');
  });
});
