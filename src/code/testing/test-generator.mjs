// Générateur de squelettes de test : déterministe, dans le style RÉEL du projet (détecté depuis
// un test existant), avec cas limites suggérés depuis la signature du symbole. Le squelette est
// un point de départ honnête (assertions à compléter), pas un test prétendu complet.

const DEFAULT_STYLE = Object.freeze({
  framework: 'vitest',
  imports: "import { describe, expect, it } from 'vitest';",
  usesVi: false,
});

export function createTestGenerator({ symbolIndex, fileContent = () => null, projectContext = null } = {}) {
  if (!symbolIndex) throw new TypeError('test_generator_symbol_index_required');

  function detectTestStyle() {
    const testFile = (projectContext?.tree ?? []).find((entry) => entry.includes('.test.'))
      ?? symbolIndex.files().find((entry) => entry.includes('.test.'));
    const source = testFile ? fileContent(testFile) : null;
    if (!source) return DEFAULT_STYLE;
    return Object.freeze({
      framework: source.includes("from 'vitest'") ? 'vitest' : source.includes("require('jest')") || source.includes('@jest/globals') ? 'jest' : 'vitest',
      imports: source.includes(' vi ') || source.includes(' vi,')
        ? "import { describe, expect, it, vi } from 'vitest';"
        : DEFAULT_STYLE.imports,
      usesVi: source.includes('vi.'),
    });
  }

  function suggestEdgeCases(symbolId) {
    const symbol = symbolIndex.get(symbolId);
    if (!symbol) throw new Error(`test_generator_symbol_unknown: ${symbolId}`);
    const cases = [];
    for (const param of symbol.params ?? []) {
      if (param.name.startsWith('...')) {
        cases.push({ param: param.name, value: '[]', label: 'aucun argument rest' });
        continue;
      }
      if (param.name === '{…}') {
        cases.push({ param: param.name, value: '{}', label: 'objet vide' });
        cases.push({ param: param.name, value: 'undefined', label: 'options absentes' });
        continue;
      }
      cases.push({ param: param.name, value: 'undefined', label: `${param.name} absent` });
      cases.push({ param: param.name, value: "''", label: `${param.name} chaîne vide` });
      cases.push({ param: param.name, value: '0', label: `${param.name} zéro` });
    }
    if (cases.length === 0) cases.push({ param: null, value: null, label: 'appel sans argument' });
    return Object.freeze(cases.map((entry) => Object.freeze(entry)));
  }

  function importPathFor(symbolFile) {
    const clean = symbolFile.replace(/\\/gu, '/');
    return clean.startsWith('src/') ? `../../${clean}` : `../${clean}`;
  }

  function generateForSymbol(symbolId) {
    const symbol = symbolIndex.get(symbolId);
    if (!symbol) throw new Error(`test_generator_symbol_unknown: ${symbolId}`);
    const style = detectTestStyle();
    const edgeCases = suggestEdgeCases(symbolId);
    const baseName = symbol.file.split('/').pop().replace(/\.[cm]?js$/u, '');
    const testFile = `tests/code/${baseName}.test.mjs`;
    const callArgs = (symbol.params ?? []).map(() => 'undefined').join(', ');

    const lines = [
      style.imports,
      `import { ${symbol.name.split('.')[0]} } from '${importPathFor(symbol.file)}';`,
      '',
      `describe('${symbol.name}', () => {`,
      `  it('cas nominal — à compléter avec une vraie assertion métier', () => {`,
      `    // TODO(Mina Code): remplacer par le comportement attendu réel.`,
      `    expect(typeof ${symbol.name.split('.')[0]}).toBe('${symbol.kind === 'class' ? 'function' : 'function'}');`,
      '  });',
      '',
      ...edgeCases.slice(0, 4).flatMap((edge) => [
        `  it('cas limite : ${edge.label}', () => {`,
        `    // TODO(Mina Code): vérifier le comportement pour ${edge.label}.`,
        `    expect(() => ${symbol.name.split('.')[0]}(${edge.value ?? callArgs})).toBeDefined();`,
        '  });',
        '',
      ]),
      '});',
    ];

    return Object.freeze({
      file: testFile,
      framework: style.framework,
      symbol: symbol.name,
      edgeCases,
      content: lines.join('\n'),
    });
  }

  function generateForFile(filePath) {
    const record = symbolIndex.byFile(filePath.replace(/\\/gu, '/'));
    if (!record) throw new Error(`test_generator_file_unknown: ${filePath}`);
    return Object.freeze(record.symbols
      .filter((symbol) => symbol.visibility === 'exported' && ['function', 'class'].includes(symbol.kind))
      .map((symbol) => generateForSymbol(symbol.id)));
  }

  return Object.freeze({ generateForSymbol, generateForFile, detectTestStyle, suggestEdgeCases });
}
