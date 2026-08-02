import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, import.meta.url), 'utf8'));
}

describe('Firebase deployment configuration', () => {
  it('targets Mina Vision rules and exposes an isolated local emulator stack', async () => {
    const config = await readJson('../firebase.json');
    const projects = await readJson('../.firebaserc');

    expect(projects.projects.default).toBe('mina-vision');
    expect(config.firestore).toEqual({ rules: 'firebase/firestore.rules' });
    expect(config.storage).toEqual({ rules: 'firebase.storage.rules' });
    expect(config.emulators).toMatchObject({
      auth: { port: 9099 },
      firestore: { port: 8080 },
      storage: { port: 9199 },
      ui: { enabled: true, port: 4000 },
      singleProjectMode: true,
    });
  });

  it('wires a JDK 21 loopback-only emulator recipe', async () => {
    const packageJson = await readJson('../package.json');
    const runner = await readFile(new URL('../scripts/run-firebase-emulator-smoke.ps1', import.meta.url), 'utf8');
    const smoke = await readFile(new URL('../scripts/firebase-emulator-smoke.mjs', import.meta.url), 'utf8');

    expect(packageJson.scripts['test:firebase:emulator']).toBe('powershell -NoProfile -File scripts/run-firebase-emulator-smoke.ps1');
    expect(runner).toContain("-like 'jdk-21*'");
    expect(runner).toContain("--only 'auth,firestore,storage'");
    expect(smoke).toContain("host: '127.0.0.1'");
    expect(smoke).toContain('firebase_emulator_environment_required');
  });
});
