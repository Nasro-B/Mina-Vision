import { describe, expect, it } from 'vitest';
import { buildWsbConfig } from '../src/sandbox/wsb-builder.mjs';

const paths = Object.freeze({
  sourcePath: 'C:\\MinaJobs\\job-1\\src',
  outPath: 'C:\\MinaJobs\\job-1\\out',
  bootstrapPath: 'C:\\MinaRuntime\\bootstrap',
});

describe('hardened Windows Sandbox configuration', () => {
  it('disables guest integrations and maps only sources/bootstrap read-only plus out writable', () => {
    const xml = buildWsbConfig(paths, {
      forbiddenRoots: ['C:\\Serveurs\\Mina Vision', 'C:\\Users\\Nasro', 'C:\\Users\\Nasro\\.mina'],
    });
    for (const setting of [
      '<Networking>Disable</Networking>',
      '<ClipboardRedirection>Disable</ClipboardRedirection>',
      '<PrinterRedirection>Disable</PrinterRedirection>',
      '<VideoInput>Disable</VideoInput>',
      '<AudioInput>Disable</AudioInput>',
      '<VGpu>Disable</VGpu>',
      '<ProtectedClient>Enable</ProtectedClient>',
    ]) expect(xml).toContain(setting);
    expect(xml.match(/<MappedFolder>/gu)).toHaveLength(3);
    expect(xml).toContain('<SandboxFolder>C:\\Mina\\src</SandboxFolder>');
    expect(xml).toContain('<SandboxFolder>C:\\Mina\\out</SandboxFolder>');
    expect(xml).toContain('<ReadOnly>true</ReadOnly>');
    expect(xml).toContain('<ReadOnly>false</ReadOnly>');
    expect(xml).not.toContain('C:\\Serveurs\\Mina Vision');
    expect(xml).not.toContain('C:\\Users\\Nasro');
  });

  it('rejects project, profile, Mina home and overlapping mapped folders', () => {
    for (const hostile of ['C:\\Serveurs\\Mina Vision', 'C:\\Users\\Nasro', 'C:\\Users\\Nasro\\.mina\\skills']) {
      expect(() => buildWsbConfig({ ...paths, sourcePath: hostile }, {
        forbiddenRoots: ['C:\\Serveurs\\Mina Vision', 'C:\\Users\\Nasro', 'C:\\Users\\Nasro\\.mina'],
      })).toThrow('sandbox_mapped_folder_forbidden');
    }
    expect(() => buildWsbConfig({ ...paths, outPath: paths.sourcePath }, { forbiddenRoots: [] }))
      .toThrow('sandbox_mapped_folder_overlap');
  });

  it('XML-escapes host paths and never accepts a caller-provided logon command', () => {
    const xml = buildWsbConfig({ ...paths, sourcePath: 'C:\\MinaJobs\\A&B\\src' }, { forbiddenRoots: [] });
    expect(xml).toContain('C:\\MinaJobs\\A&amp;B\\src');
    expect(xml).toContain('C:\\Mina\\bootstrap\\mina-runner.mjs');
    expect(xml).not.toContain('Bypass');
  });
});
