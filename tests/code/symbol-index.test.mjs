import { describe, expect, it } from 'vitest';
import { createSymbolIndex } from '../../src/code/intelligence/symbol-index.mjs';

const symbol = (id, name, kind = 'function', extra = {}) => ({ id, name, kind, file: extra.file ?? 'a.mjs', visibility: 'exported', ...extra });

describe('symbol-index', () => {
  it('ajoute un fichier et retrouve par id, nom et kind', () => {
    const index = createSymbolIndex();
    index.addFile('src/a.mjs', {
      symbols: [symbol('s1', 'createService'), symbol('s2', 'LIMIT', 'constant')],
      hash: 'sha256:aa',
    });
    expect(index.get('s1').name).toBe('createService');
    expect(index.byName('service')).toHaveLength(1);
    expect(index.byName('createService', { exact: true })).toHaveLength(1);
    expect(index.byKind('constant').map((entry) => entry.name)).toEqual(['LIMIT']);
    expect(index.hashOf('src/a.mjs')).toBe('sha256:aa');
  });

  it('la recherche par nom est insensible à la casse et vide → []', () => {
    const index = createSymbolIndex();
    index.addFile('a.mjs', { symbols: [symbol('s1', 'MaFonction')] });
    expect(index.byName('mafonction', { exact: true })).toHaveLength(1);
    expect(index.byName('')).toEqual([]);
  });

  it('réindexer un fichier remplace atomiquement ses anciens symboles', () => {
    const index = createSymbolIndex();
    index.addFile('a.mjs', { symbols: [symbol('vieux', 'ancienne')] });
    index.addFile('a.mjs', { symbols: [symbol('neuf', 'nouvelle')], hash: 'sha256:bb' });
    expect(index.get('vieux')).toBeNull();
    expect(index.get('neuf').name).toBe('nouvelle');
    expect(index.stats()).toEqual({ files: 1, symbols: 1 });
  });

  it('removeFile purge les symboles et retourne false si absent', () => {
    const index = createSymbolIndex();
    index.addFile('a.mjs', { symbols: [symbol('s1', 'x')] });
    expect(index.removeFile('a.mjs')).toBe(true);
    expect(index.removeFile('a.mjs')).toBe(false);
    expect(index.get('s1')).toBeNull();
    expect(index.files()).toEqual([]);
  });

  it('expose imports, exports et appels par fichier', () => {
    const index = createSymbolIndex();
    index.addFile('a.mjs', {
      imports: [{ source: './b.mjs', specifiers: ['aide'], isDynamic: false }],
      exports: [{ name: 'x', kind: 'function', isDefault: false }],
      calls: [{ callerName: 'x', calleeName: 'aide', line: 3 }],
    });
    expect(index.importsOf('a.mjs')[0].source).toBe('./b.mjs');
    expect(index.exportsOf('a.mjs')[0].name).toBe('x');
    expect(index.callsOf('a.mjs')[0].calleeName).toBe('aide');
    expect(index.importsOf('inconnu.mjs')).toEqual([]);
  });

  it('valide le chemin de fichier', () => {
    const index = createSymbolIndex();
    expect(() => index.addFile('')).toThrow(/symbol_index_file_required/u);
  });

  it('les structures retournées sont gelées', () => {
    const index = createSymbolIndex();
    index.addFile('a.mjs', { symbols: [symbol('s1', 'x')] });
    expect(Object.isFrozen(index.byName('x'))).toBe(true);
    expect(Object.isFrozen(index.files())).toBe(true);
    expect(Object.isFrozen(index.stats())).toBe(true);
  });
});
