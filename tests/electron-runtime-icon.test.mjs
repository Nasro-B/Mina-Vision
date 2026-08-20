import { basename, dirname, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Electron Windows runtime identity', () => {
  it('prepares a Mina-named executable next to Electron without replacing electron.exe', async () => {
    const { resolveRuntimePaths } = await import('../scripts/prepare-electron-runtime.mjs');
    const paths = resolveRuntimePaths({ rootDir: resolve('.') });

    expect(basename(paths.sourceExe)).toBe('electron.exe');
    expect(basename(paths.targetExe)).toBe('Mina Vision.exe');
    expect(dirname(paths.targetExe)).toBe(dirname(paths.sourceExe));
    expect(paths.targetExe).not.toBe(paths.sourceExe);
    expect(paths.icon).toContain('mina-vision.ico');
  });

  it('launch-mina uses the prepared Mina executable, not raw Electron directly', async () => {
    const source = await readFile('scripts/launch-mina.ps1', 'utf8');

    expect(source).toContain('prepare-electron-runtime.mjs');
    expect(source).toContain('$runtimeResult.exe');
  });

  it('normal launch scripts go through the Mina runtime launcher instead of raw electron', async () => {
    const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
    const startScript = await readFile('scripts/start-mina.ps1', 'utf8');

    expect(packageJson.scripts.start).toContain('scripts/launch-mina.ps1');
    expect(packageJson.scripts.start).not.toBe('electron .');
    expect(packageJson.scripts.smoke).toContain('scripts/launch-mina.ps1');
    expect(startScript).toContain('launch-mina.ps1');
    expect(startScript).not.toContain('npm start');
  });

  it('desktop shortcut carries the same Windows AppUserModelID as the app', async () => {
    const source = await readFile('scripts/install-shortcut.ps1', 'utf8');

    expect(source).toContain('System.AppUserModel.ID');
    expect(source).toContain('fr.sourireconcept.minavision');
    expect(source).toContain('mina-vision.ico');
  });
});
