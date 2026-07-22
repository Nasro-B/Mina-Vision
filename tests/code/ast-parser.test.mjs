import { describe, expect, it } from 'vitest';
import { createAstParser, fileHash, SymbolKind } from '../../src/code/intelligence/ast-parser.mjs';

const parser = createAstParser();

const SAMPLE = `
import { readFile } from 'node:fs/promises';
import helper from './helper.mjs';

const LIMIT = 10;
let compteur = 0;

export function createService({ reader }) {
  return reader;
}

export const fleche = (valeur = 1) => valeur + LIMIT;

function interne(...args) {
  return createService({ reader: args });
}

export class Machine {
  demarrer(vitesse) {
    return interne(vitesse);
  }
}

export default Machine;
`;

describe('ast-parser — parsing et validation', () => {
  it('valide un module ESM correct', () => {
    expect(parser.validate(SAMPLE)).toEqual({ valid: true });
  });

  it('bascule en mode script pour du CJS (return hors module interdit → erreur propre)', () => {
    expect(parser.validate('const x = require("fs"); module.exports = x;').valid).toBe(true);
  });

  it('signale une erreur nominée sur syntaxe invalide, sans exception', () => {
    const result = parser.validate('function {');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/ast_parse_failed/u);
    const parsed = parser.parseFile('function {', { filePath: 'cassé.mjs' });
    expect(parsed.error).toMatch(/ast_parse_failed/u);
    expect(parsed.symbols).toEqual([]);
  });

  it('calcule un hash sha256 stable et sensible au contenu', () => {
    expect(fileHash('abc')).toBe(fileHash('abc'));
    expect(fileHash('abc')).not.toBe(fileHash('abd'));
    expect(fileHash('abc')).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });
});

describe('ast-parser — symboles', () => {
  const parsed = parser.parseFile(SAMPLE, { filePath: 'src/service.mjs' });
  const names = parsed.symbols.map((symbol) => symbol.name);

  it('extrait fonctions, flèches, classes, méthodes, constantes et variables', () => {
    expect(names).toContain('createService');
    expect(names).toContain('fleche');
    expect(names).toContain('interne');
    expect(names).toContain('Machine');
    expect(names).toContain('Machine.demarrer');
    expect(names).toContain('LIMIT');
    expect(names).toContain('compteur');
  });

  it('attribue les bons kinds', () => {
    const byName = Object.fromEntries(parsed.symbols.map((symbol) => [symbol.name, symbol]));
    expect(byName.createService.kind).toBe(SymbolKind.FUNCTION);
    expect(byName.fleche.kind).toBe(SymbolKind.FUNCTION);
    expect(byName.Machine.kind).toBe(SymbolKind.CLASS);
    expect(byName['Machine.demarrer'].kind).toBe(SymbolKind.METHOD);
    expect(byName.LIMIT.kind).toBe(SymbolKind.CONSTANT);
    expect(byName.compteur.kind).toBe(SymbolKind.VARIABLE);
  });

  it('marque la visibilité exported/internal', () => {
    const byName = Object.fromEntries(parsed.symbols.map((symbol) => [symbol.name, symbol]));
    expect(byName.createService.visibility).toBe('exported');
    expect(byName.Machine.visibility).toBe('exported');
    expect(byName.interne.visibility).toBe('internal');
    expect(byName.compteur.visibility).toBe('internal');
  });

  it('extrait les paramètres avec optionnalité et rest', () => {
    const byName = Object.fromEntries(parsed.symbols.map((symbol) => [symbol.name, symbol]));
    expect(byName.createService.params).toEqual([{ name: '{…}', optional: false }]);
    expect(byName.fleche.params).toEqual([{ name: 'valeur', optional: true }]);
    expect(byName.interne.params).toEqual([{ name: '...args', optional: true }]);
  });

  it('donne des positions de ligne réelles et un id unique par symbole', () => {
    const byName = Object.fromEntries(parsed.symbols.map((symbol) => [symbol.name, symbol]));
    expect(byName.createService.startLine).toBeGreaterThan(1);
    expect(byName.createService.endLine).toBeGreaterThan(byName.createService.startLine);
    const ids = parsed.symbols.map((symbol) => symbol.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('ast-parser — imports, exports, appels', () => {
  const parsed = parser.parseFile(SAMPLE, { filePath: 'src/service.mjs' });

  it('extrait les imports statiques avec spécificateurs', () => {
    expect(parsed.imports).toContainEqual({ source: 'node:fs/promises', specifiers: ['readFile'], isDynamic: false });
    expect(parsed.imports).toContainEqual({ source: './helper.mjs', specifiers: ['helper'], isDynamic: false });
  });

  it('détecte import() dynamique et require()', () => {
    const dynamic = parser.parseFile('const m = await import("./x.mjs"); const y = require("./y.cjs");');
    expect(dynamic.imports.some((entry) => entry.isDynamic)).toBe(true);
    expect(dynamic.imports).toContainEqual({ source: './y.cjs', specifiers: [], isDynamic: false });
  });

  it('extrait exports nommés et défaut', () => {
    const exportNames = parsed.exports.map((entry) => entry.name);
    expect(exportNames).toContain('createService');
    expect(exportNames).toContain('fleche');
    expect(exportNames).toContain('Machine');
    expect(parsed.exports.some((entry) => entry.isDefault)).toBe(true);
  });

  it('relie les sites d\'appel à leur fonction englobante', () => {
    expect(parsed.calls).toContainEqual(expect.objectContaining({ callerName: 'interne', calleeName: 'createService' }));
    expect(parsed.calls).toContainEqual(expect.objectContaining({ callerName: 'demarrer', calleeName: 'interne' }));
  });

  it('les appels hors fonction sont attribués à (module)', () => {
    const topLevel = parser.parseFile('démarrage();'.replace('démarrage', 'boot'));
    expect(topLevel.calls[0]).toMatchObject({ callerName: '(module)', calleeName: 'boot' });
  });

  it('le résultat est intégralement gelé', () => {
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.symbols)).toBe(true);
    expect(Object.isFrozen(parsed.symbols[0])).toBe(true);
  });
});
