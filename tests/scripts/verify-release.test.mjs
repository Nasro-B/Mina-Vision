import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { buildNpmRunCommand, verifyRelease } from '../../scripts/verify-release.mjs';

describe('verifyRelease', () => {
  it('fails when one automated check fails', async () => {
    const report = await verifyRelease({
      commands: [
        { name: 'unit', run: async () => ({ exitCode: 0 }) },
        { name: 'smoke', run: async () => ({ exitCode: 1 }) },
      ],
      requiredCapabilities: [],
      clock: () => 0,
    });

    expect(report.status).toBe('fail');
    expect(report.checks.find((entry) => entry.name === 'smoke')).toMatchObject({
      exitCode: 1,
      status: 'fail',
    });
    expect(report.generatedAt).toBe(0);
  });

  it('fails when a required capability is not available and keeps manual rows unrun', async () => {
    const report = await verifyRelease({
      commands: [{
        name: 'verify',
        run: async () => ({
          exitCode: 0,
          capabilities: {
            'models.lm_studio': { status: 'degraded', reason: 'lm_studio_unreachable' },
          },
        }),
      }],
      requiredCapabilities: ['models.lm_studio'],
      clock: () => 1,
    });

    expect(report.status).toBe('fail');
    expect(report.checks).toContainEqual(expect.objectContaining({
      name: 'capability:models.lm_studio',
      status: 'fail',
      reason: 'capability_not_available:models.lm_studio',
    }));
    expect(report.manual).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'android_physical_acceptance', status: 'unrun' }),
    ]));
    expect(report.manual.every((entry) => entry.status === 'unrun')).toBe(true);
  });

  it('bounds and redacts command output in the report', async () => {
    const report = await verifyRelease({
      commands: [{
        name: 'unit',
        run: async () => ({ exitCode: 0, stdout: `token=should-not-appear ${'x'.repeat(4_096)}` }),
      }],
      requiredCapabilities: [],
      clock: () => 2,
    });

    const output = report.checks[0].stdout;
    expect(output).not.toContain('should-not-appear');
    expect(output.length).toBeLessThanOrEqual(2_000);
  });

  it('wires the reproducible runner as the release script', async () => {
    const packageJson = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));

    expect(packageJson.scripts['verify:release']).toBe('node scripts/verify-release.mjs');
    expect(packageJson.scripts['test:release']).toBe('npm run verify:release');
  });

  it('uses an executable argument-array launcher for npm scripts on Windows', () => {
    expect(buildNpmRunCommand('test:unit', {
      npmExecPath: 'C:\\node\\npm-cli.js',
      nodeExecutable: 'C:\\node\\node.exe',
      platform: 'win32',
    })).toEqual({
      command: 'C:\\node\\node.exe',
      args: ['C:\\node\\npm-cli.js', 'run', 'test:unit'],
    });

    expect(buildNpmRunCommand('test:unit', {
      npmExecPath: '',
      platform: 'win32',
      comSpec: 'C:\\Windows\\System32\\cmd.exe',
    })).toEqual({
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', 'npm run test:unit'],
    });
  });
});
