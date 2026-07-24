import { describe, expect, it } from 'vitest';
import {
  buildRuntimeManifest,
  compareSemverDesc,
  decodeChecksumBytes,
  expectedChecksumFor,
  parseChecksumsFile,
  selectLatestNodeLts,
} from '../src/sandbox/runtime-provisioning.mjs';
import { createRuntimeManifest } from '../src/sandbox/runtime-manifest.mjs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HASH64 = (seed) => createHash('sha256').update(seed).digest('hex');

describe('runtime provisioning — pure logic', () => {
  it('parses GNU-coreutils checksum files (space and binary-star separators)', () => {
    const map = parseChecksumsFile([
      `${'a'.repeat(64)}  node-v22.14.0-win-x64.zip`,
      `${'b'.repeat(64)} *PowerShell-7.4.6-win-x64.zip`,
      '# comment ignored',
      'garbage line',
    ].join('\n'));
    expect(map.get('node-v22.14.0-win-x64.zip')).toBe('a'.repeat(64));
    expect(map.get('PowerShell-7.4.6-win-x64.zip')).toBe('b'.repeat(64));
    expect(map.size).toBe(2);
  });

  it('decodes UTF-16LE/BE and UTF-8(+BOM) checksum files (PowerShell ships UTF-16LE)', () => {
    const line = `${'a'.repeat(64)} *PowerShell-7.4.18-win-x64.zip`;
    const utf16le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(line, 'utf16le')]);
    const utf8bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(line, 'utf8')]);
    // Le bug réel : lire l'UTF-16 en UTF-8 rendait la ligne non-parsable → zip NON vérifié.
    expect(expectedChecksumFor(parseChecksumsFile(decodeChecksumBytes(utf16le)), 'PowerShell-7.4.18-win-x64.zip')).toBe('a'.repeat(64));
    expect(expectedChecksumFor(parseChecksumsFile(decodeChecksumBytes(utf8bom)), 'PowerShell-7.4.18-win-x64.zip')).toBe('a'.repeat(64));
    expect(decodeChecksumBytes(Buffer.from(line, 'utf8'))).toContain('PowerShell');
  });

  it('matches a checksum by basename even when the manifest lists a path', () => {
    const map = parseChecksumsFile(`${'c'.repeat(64)}  ./win-x64/node.zip`);
    expect(expectedChecksumFor(map, 'node.zip')).toBe('c'.repeat(64));
    expect(expectedChecksumFor(map, 'absent.zip')).toBeNull();
  });

  it('selects the newest LTS patch on a major line WITHOUT assuming the number', () => {
    const index = [
      { version: 'v22.9.0', lts: false },
      { version: 'v22.14.0', lts: 'Jod' },
      { version: 'v22.11.0', lts: 'Jod' },
      { version: 'v20.18.0', lts: 'Iron' },
    ];
    expect(selectLatestNodeLts(index, 22)).toEqual({ version: 'v22.14.0', semver: '22.14.0' });
    expect(selectLatestNodeLts([{ version: 'v23.1.0', lts: false }], 22)).toBeNull();
  });

  it('orders semver descending', () => {
    expect(['v22.9.0', 'v22.14.0', 'v22.11.0'].sort(compareSemverDesc)).toEqual(['v22.14.0', 'v22.11.0', 'v22.9.0']);
  });

  it('rejects an incomplete or malformed manifest before it is ever written', () => {
    expect(() => buildRuntimeManifest([])).toThrow('runtime_provisioning_incomplete');
    expect(() => buildRuntimeManifest([
      { language: 'python', version: '3.12.7', sha256: HASH64('py'), sourceUrl: 'https://python.org/x.zip', path: 'python/python.exe' },
      { language: 'javascript', version: '22.14.0', sha256: HASH64('js'), sourceUrl: 'https://nodejs.org/x.zip', path: 'node/node.exe' },
      { language: 'powershell', version: '7.4.6', sha256: 'nothex', sourceUrl: 'https://github.com/x.zip', path: 'pwsh/pwsh.exe' },
    ])).toThrow('runtime_sha256_invalid:powershell');
    expect(() => buildRuntimeManifest([
      { language: 'python', version: '3.12.7', sha256: HASH64('py'), sourceUrl: 'http://insecure/x.zip', path: 'python/python.exe' },
      { language: 'javascript', version: '22.14.0', sha256: HASH64('js'), sourceUrl: 'https://nodejs.org/x.zip', path: 'node/node.exe' },
      { language: 'powershell', version: '7.4.6', sha256: HASH64('ps'), sourceUrl: 'https://github.com/x.zip', path: 'pwsh/pwsh.exe' },
    ])).toThrow('runtime_source_invalid:python');
    expect(() => buildRuntimeManifest([
      { language: 'python', version: '3.12.7', sha256: HASH64('py'), sourceUrl: 'https://python.org/x.zip', path: '../escape.exe' },
      { language: 'javascript', version: '22.14.0', sha256: HASH64('js'), sourceUrl: 'https://nodejs.org/x.zip', path: 'node/node.exe' },
      { language: 'powershell', version: '7.4.6', sha256: HASH64('ps'), sourceUrl: 'https://github.com/x.zip', path: 'pwsh/pwsh.exe' },
    ])).toThrow('runtime_path_invalid:python');
  });

  it('produces a manifest the REAL guest verifier accepts (round-trip against on-disk runtimes)', async () => {
    // Preuve de bout en bout : le manifeste assemblé, écrit avec de vrais fichiers dont le sha256
    // correspond, est déclaré available:true par le même createRuntimeManifest que le sandbox.
    const root = await mkdtemp(join(tmpdir(), 'mina-rt-'));
    try {
      const files = [
        { language: 'python', path: 'python/python.exe', body: 'PY-BINARY' },
        { language: 'javascript', path: 'node/node.exe', body: 'NODE-BINARY' },
        { language: 'powershell', path: 'pwsh/pwsh.exe', body: 'PWSH-BINARY' },
      ];
      const entries = [];
      for (const file of files) {
        await mkdir(join(root, file.path, '..'), { recursive: true });
        await writeFile(join(root, ...file.path.split('/')), file.body);
        entries.push({
          language: file.language,
          version: file.language === 'python' ? '3.12.7' : file.language === 'javascript' ? '22.14.0' : '7.4.6',
          sha256: createHash('sha256').update(file.body).digest('hex'),
          sourceUrl: 'https://example.test/official.zip',
          path: file.path,
        });
      }
      const manifest = buildRuntimeManifest(entries);
      await writeFile(join(root, 'runtime-manifest.json'), JSON.stringify(manifest, null, 2));

      const verifier = createRuntimeManifest({ manifestPath: join(root, 'runtime-manifest.json'), runtimeRoot: root });
      const result = await verifier.verify();
      expect(result).toMatchObject({ available: true, reason: null });
      expect(result.runtimes.map((r) => r.language).sort()).toEqual(['javascript', 'powershell', 'python']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
