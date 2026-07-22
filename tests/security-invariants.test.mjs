// Threat model exécutable (amélioration B) : chaque invariant encode une défense qui ne doit
// JAMAIS être débranchée silencieusement. Si un refactor retire un branchement, un de ces tests
// casse — le document de menace vit ici, pas dans un .md que personne ne relit.

import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { classifyAction, classifyCapabilityBase } from '../src/safety/policy.mjs';
import { createCapabilityBroker } from '../src/safety/capability-broker.mjs';
import { createResearchUrlPolicy } from '../src/research/url-policy.mjs';
import { createFilePolicy } from '../src/research/file-policy.mjs';

const source = (relative) => readFile(new URL(`../${relative}`, import.meta.url), 'utf8');

describe('invariants sécurité (threat model exécutable)', () => {
  it('INVARIANT 1 — le broker est branché en autorité dans startMission, avec grant borné', async () => {
    const main = await source('src/ui/main.mjs');
    expect(main).toContain('createComputerActionAuthorizer({ capabilityBroker: missionBroker })');
    expect(main).toContain("capabilities: ['computer.*']");
    expect(main).toContain('expiresAt: new Date(Date.now() + activeRuntime.config.missionTimeoutMs');
  });

  it('INVARIANT 2 — sans grant de session, le broker refuse TOUT, même une lecture', async () => {
    const broker = createCapabilityBroker({ grants: [] });
    await expect(broker.authorize({
      sessionId: 'w', channel: 'local', capability: 'computer.move', effect: 'read', resource: 'x', digest: 'sha256:0',
    })).resolves.toMatchObject({ decision: 'deny', reason: 'session_grant' });
  });

  it('INVARIANT 3 — fail-closed : sensitivity absente = confirmation exigée pour tout effet', () => {
    expect(classifyCapabilityBase({ capability: 'computer.click', effect: 'execute' }))
      .toMatchObject({ decision: 'confirm' });
    expect(classifyCapabilityBase({ capability: 'mail.send', effect: 'send', sensitivity: 'ordinary' }))
      .toMatchObject({ decision: 'confirm' });
  });

  it('INVARIANT 4 — gestionnaires de mots de passe, terminaux et outils sécurité restent bloqués dur', () => {
    for (const app of ['1Password', 'Bitwarden', 'KeePass', 'Windows Security', 'PowerShell', 'cmd.exe']) {
      expect(classifyAction({ name: 'click', x: 1, y: 1 }, { app }).decision).toBe('block');
    }
    expect(classifyCapabilityBase({ capability: 'computer.password_manager', effect: 'execute' }).decision).toBe('deny');
    expect(classifyCapabilityBase({ capability: 'system.terminal', effect: 'execute' }).decision).toBe('deny');
  });

  it('INVARIANT 5 — la politique SSRF est branchée dans la composition mémoire réelle', async () => {
    const composition = await source('src/memory/composition.mjs');
    expect(composition).toContain('createResearchUrlPolicy()');
    expect(composition).toContain('urlPolicy');
  });

  it('INVARIANT 6 — les adresses de métadonnées cloud et loopback sont refusées', async () => {
    const policy = createResearchUrlPolicy({ lookup: vi.fn(async () => [{ address: '169.254.169.254', family: 4 }]) });
    await expect(policy.authorize('http://169.254.169.254/latest/meta-data/')).rejects.toThrow('private_network_forbidden');
    await expect(policy.authorize('http://127.0.0.1:8080/')).rejects.toThrow('private_network_forbidden');
    await expect(policy.authorize('https://metadata.internal.test/')).rejects.toThrow('private_network_forbidden');
  });

  it('INVARIANT 7 — .env et credentials restent illisibles par la recherche fichiers', async () => {
    const policy = await createFilePolicy({
      approvedRoots: [],
      fileSystem: { realpath: async (p) => p, stat: async () => ({ isDirectory: () => true }) },
    });
    for (const path of ['C:\\projet\\.env', 'C:\\x\\client_secret_1.json', 'C:\\x\\service-account.json', 'C:\\x\\site.pem', 'C:\\x\\cle.key']) {
      await expect(policy.authorize({ path, operation: 'read', confirmed: true }))
        .rejects.toThrow('sensitive_file_forbidden');
    }
  });

  it('INVARIANT 8 — le journal double couche est branché : sanitizer + couche chiffrée', async () => {
    const main = await source('src/ui/main.mjs');
    expect(main).toContain('sensitiveSink: sensitiveJournalStore');
    const journal = await source('src/diagnostics/activity-journal.mjs');
    expect(journal).toContain('sanitizeJournalPayload(kind, payload)');
  });

  it('INVARIANT 9 — aucune clé API en dur dans src/ (motifs de secrets réels)', async () => {
    const { readdir } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const files = [];
    const walk = async (directory) => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const absolute = join(directory, entry.name);
        if (entry.isDirectory()) await walk(absolute);
        else if (/\.(mjs|cjs|js)$/u.test(entry.name)) files.push(absolute);
      }
    };
    await walk(fileURLToPath(new URL('../src', import.meta.url)));
    const offenders = [];
    const SECRET_PATTERNS = [
      /AIza[0-9A-Za-z_-]{35}/u,
      /sk-[A-Za-z0-9]{40,}/u,
      /gsk_[A-Za-z0-9]{40,}/u,
      /hf_[A-Za-z0-9]{30,}/u,
      /ghp_[A-Za-z0-9]{36}/u,
    ];
    for (const file of files) {
      const content = await readFile(file, 'utf8');
      if (SECRET_PATTERNS.some((pattern) => pattern.test(content))) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('INVARIANT 10 — les limites anti-bombe d\'archive existent dans les DEUX surfaces zip', async () => {
    const installer = await source('src/skills/skill-installer.mjs');
    expect(installer).toContain('skill_archive_expansion_limit');
    expect(installer).toContain('MAX_EXPANSION_RATIO');
    const quarantine = await source('src/mail/attachment-quarantine.mjs');
    expect(quarantine).toContain('attachment_archive_expansion_limit');
  });
});
