import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('start-mina.ps1: mode flags stay process-scoped, no side effects at startup', () => {
  it('rejects -Offline combined with -Mode Auto before doing anything else', async () => {
    const script = await readFile(new URL('../../scripts/start-mina.ps1', import.meta.url), 'utf8');
    expect(script).toMatch(/Offline.*Mode -eq 'Auto'/su);
    expect(script).toContain('exit 1');
  });

  it('only sets process-scoped $env: variables, never a persistent user/system environment variable', async () => {
    const script = await readFile(new URL('../../scripts/start-mina.ps1', import.meta.url), 'utf8');
    expect(script).toMatch(/\$env:MINA_INFERENCE_MODE/u);
    expect(script).toMatch(/\$env:MINA_OFFLINE/u);
    expect(script).not.toMatch(/setx|\[Environment\]::SetEnvironmentVariable/iu);
  });

  it('never runs npm install and never enables ADB Wi-Fi debugging itself', async () => {
    const script = await readFile(new URL('../../scripts/start-mina.ps1', import.meta.url), 'utf8');
    const executableLines = script.split(/\r?\n/).filter((line) => !line.trim().startsWith('#')).join('\n');
    expect(executableLines).not.toMatch(/npm\s+(ci|install)/iu);
    expect(executableLines).not.toMatch(/tcpip\s+5555|adb\s+connect/iu);
  });

  it('calls verify-mina.ps1 before the Mina runtime launcher', async () => {
    const script = await readFile(new URL('../../scripts/start-mina.ps1', import.meta.url), 'utf8');
    const verifyIndex = script.indexOf('verify-mina.ps1');
    const startIndex = script.indexOf('launch-mina.ps1');
    expect(verifyIndex).toBeGreaterThan(-1);
    expect(startIndex).toBeGreaterThan(verifyIndex);
    expect(script).not.toContain('npm start');
  });
});

describe('verify-mina.ps1: read-only, delegates to the Node health report', () => {
  it('never writes files, never calls adb connect/tcpip, and only invokes the Node verifier', async () => {
    const script = await readFile(new URL('../../scripts/verify-mina.ps1', import.meta.url), 'utf8');
    expect(script).toContain('verify-mina.mjs');
    expect(script).not.toMatch(/tcpip\s+5555|adb\s+connect|Set-Content|Out-File|New-Item/iu);
  });
});

describe('launch-mina.ps1: cache canonique après déplacement', () => {
  it('uses only G:\\Programmes Installés\\caches when G: is available', async () => {
    const script = await readFile(new URL('../../scripts/launch-mina.ps1', import.meta.url), 'utf8');
    expect(script).toContain("G:\\Programmes Installés\\caches");
    expect(script).not.toContain("'G:\\Caches'");
    expect(script).not.toContain('G:\\DevCache');
  });
});

describe('package.json: verify and mode-specific start scripts are wired', () => {
  it('exposes verify, start:auto, start:local-first, start:local-only', async () => {
    const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(pkg.scripts.verify).toBe('node scripts/verify-mina.mjs');
    expect(pkg.scripts['start:auto']).toContain('-Mode Auto');
    expect(pkg.scripts['start:local-first']).toContain('-Mode LocalFirst');
    expect(pkg.scripts['start:local-only']).toContain('-Offline');
  });
});
