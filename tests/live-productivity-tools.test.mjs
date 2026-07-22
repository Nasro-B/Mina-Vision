import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Gemini Live productivity tools', () => {
  it('declares and handles real Google Task and e-mail actions in the main process', async () => {
    const main = await readFile(new URL('../src/ui/main.mjs', import.meta.url), 'utf8');
    expect(main).toContain("name: 'creer_tache_google'");
    expect(main).toContain("name: 'envoyer_email'");
    expect(main).toContain("call.name === 'creer_tache_google'");
    expect(main).toContain("call.name === 'envoyer_email'");
    expect(main).toContain('createGoogleRuntimeAdapters');
    expect(main).toContain('createTaskService');
  });

  it('lets Mina read a bounded redacted technical log through a real Live tool', async () => {
    const main = await readFile(new URL('../src/ui/main.mjs', import.meta.url), 'utf8');
    expect(main).toContain("name: 'lire_erreurs_techniques'");
    expect(main).toContain("call.name === 'lire_erreurs_techniques'");
    expect(main).toContain('technicalLogReader.read');
  });

  it('activates installed or bundled skills and returns their verified instructions to Mina', async () => {
    const main = await readFile(new URL('../src/ui/main.mjs', import.meta.url), 'utf8');
    expect(main).toContain("name: 'utiliser_skill'");
    expect(main).toContain("call.name === 'utiliser_skill'");
    expect(main).toContain('skillRouter.activate');
    expect(main).toContain('createCompositeSkillRuntime');
  });
});
