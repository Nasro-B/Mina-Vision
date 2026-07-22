// Parseur AST JavaScript (acorn) : extraction de symboles, imports, exports et sites d'appel.
// JavaScript/ESM/CJS uniquement — TypeScript n'est pas parsé par acorn et est signalé tel quel.

import { createHash } from 'node:crypto';
import { parse } from 'acorn';
import { ancestor as walkAncestor, simple as walkSimple } from 'acorn-walk';

export const SymbolKind = Object.freeze({
  FUNCTION: 'function',
  CLASS: 'class',
  METHOD: 'method',
  VARIABLE: 'variable',
  CONSTANT: 'constant',
  EXPORT: 'export',
  IMPORT: 'import',
});

const PARSE_OPTIONS = Object.freeze({
  ecmaVersion: 'latest',
  sourceType: 'module',
  locations: true,
  allowHashBang: true,
});

export const fileHash = (source) => `sha256:${createHash('sha256').update(String(source)).digest('hex')}`;

const symbolId = (hash, name, node) => `${hash.slice(7, 19)}::${name}::${node.loc.start.line}:${node.loc.start.column}`;

function functionParams(node) {
  return (node.params ?? []).map((param) => {
    if (param.type === 'Identifier') return { name: param.name, optional: false };
    if (param.type === 'AssignmentPattern' && param.left.type === 'Identifier') {
      return { name: param.left.name, optional: true };
    }
    if (param.type === 'RestElement' && param.argument.type === 'Identifier') {
      return { name: `...${param.argument.name}`, optional: true };
    }
    if (param.type === 'ObjectPattern') return { name: '{…}', optional: false };
    if (param.type === 'ArrayPattern') return { name: '[…]', optional: false };
    return { name: 'inconnu', optional: false };
  });
}

export function createAstParser() {
  function tryParse(source) {
    try {
      return { program: parse(String(source), PARSE_OPTIONS), error: null };
    } catch (moduleError) {
      try {
        return { program: parse(String(source), { ...PARSE_OPTIONS, sourceType: 'script' }), error: null };
      } catch {
        return { program: null, error: `ast_parse_failed: ${moduleError.message}` };
      }
    }
  }

  function validate(source) {
    const { error } = tryParse(source);
    return Object.freeze({ valid: error === null, ...(error ? { error } : {}) });
  }

  function parseFile(source, { filePath = 'inconnu.mjs' } = {}) {
    const hash = fileHash(source);
    const { program, error } = tryParse(source);
    if (error) {
      return Object.freeze({ filePath, hash, error, symbols: [], imports: [], exports: [], calls: [] });
    }

    const symbols = [];
    const imports = [];
    const exports = [];
    const exportedNames = new Set();

    for (const node of program.body) {
      if (node.type === 'ImportDeclaration') {
        imports.push({
          source: node.source.value,
          specifiers: node.specifiers.map((spec) => spec.local.name),
          isDynamic: false,
        });
      }
      if (node.type === 'ExportNamedDeclaration') {
        if (node.declaration?.type === 'FunctionDeclaration' || node.declaration?.type === 'ClassDeclaration') {
          exportedNames.add(node.declaration.id?.name);
          exports.push({ name: node.declaration.id?.name ?? 'anonyme', kind: node.declaration.type === 'ClassDeclaration' ? 'class' : 'function', isDefault: false });
        } else if (node.declaration?.type === 'VariableDeclaration') {
          for (const declarator of node.declaration.declarations) {
            if (declarator.id.type === 'Identifier') {
              exportedNames.add(declarator.id.name);
              exports.push({ name: declarator.id.name, kind: 'variable', isDefault: false });
            }
          }
        }
        for (const specifier of node.specifiers ?? []) {
          exportedNames.add(specifier.local.name);
          exports.push({ name: specifier.exported.name ?? specifier.exported.value, kind: 'reexport', isDefault: false });
        }
      }
      if (node.type === 'ExportDefaultDeclaration') {
        const name = node.declaration?.id?.name ?? 'default';
        exportedNames.add(name);
        exports.push({ name, kind: 'default', isDefault: true });
      }
    }

    walkSimple(program, {
      ImportExpression() {
        imports.push({ source: null, specifiers: [], isDynamic: true });
      },
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'require'
          && node.arguments[0]?.type === 'Literal') {
          imports.push({ source: node.arguments[0].value, specifiers: [], isDynamic: false });
        }
      },
    });

    const pushSymbol = (name, kind, node, extra = {}) => {
      symbols.push(Object.freeze({
        id: symbolId(hash, name, node),
        name,
        kind,
        file: filePath,
        startLine: node.loc.start.line,
        endLine: node.loc.end.line,
        visibility: exportedNames.has(name) ? 'exported' : 'internal',
        hash,
        ...extra,
      }));
    };

    walkAncestor(program, {
      FunctionDeclaration(node) {
        if (node.id) pushSymbol(node.id.name, SymbolKind.FUNCTION, node, { params: functionParams(node) });
      },
      ClassDeclaration(node) {
        if (node.id) pushSymbol(node.id.name, SymbolKind.CLASS, node);
      },
      MethodDefinition(node, _state, ancestors) {
        const owner = [...ancestors].reverse().find((entry) => entry.type === 'ClassDeclaration');
        const name = node.key.type === 'Identifier' ? node.key.name : String(node.key.value ?? 'méthode');
        pushSymbol(`${owner?.id?.name ?? 'classe'}.${name}`, SymbolKind.METHOD, node, { params: functionParams(node.value) });
      },
      VariableDeclarator(node, _state, ancestors) {
        if (node.id.type !== 'Identifier') return;
        const declaration = [...ancestors].reverse().find((entry) => entry.type === 'VariableDeclaration');
        const topLevel = ancestors.filter((entry) => entry.type.includes('Function') || entry.type === 'ClassDeclaration').length === 0;
        if (!topLevel) return;
        if (node.init && ['ArrowFunctionExpression', 'FunctionExpression'].includes(node.init.type)) {
          pushSymbol(node.id.name, SymbolKind.FUNCTION, node, { params: functionParams(node.init) });
        } else if (declaration?.kind === 'const') {
          pushSymbol(node.id.name, SymbolKind.CONSTANT, node);
        } else {
          pushSymbol(node.id.name, SymbolKind.VARIABLE, node);
        }
      },
    });

    // Sites d'appel : nom de l'appelé + fonction englobante (résolution par nom, assumée locale).
    const calls = [];
    walkAncestor(program, {
      CallExpression(node, _state, ancestors) {
        let calleeName = null;
        if (node.callee.type === 'Identifier') calleeName = node.callee.name;
        else if (node.callee.type === 'MemberExpression' && node.callee.property.type === 'Identifier') {
          const objectName = node.callee.object.type === 'Identifier' ? node.callee.object.name : null;
          calleeName = objectName ? `${objectName}.${node.callee.property.name}` : node.callee.property.name;
        }
        if (!calleeName) return;
        const enclosing = [...ancestors].reverse().find((entry) => (
          entry !== node && (
            entry.type === 'FunctionDeclaration'
            || (entry.type === 'VariableDeclarator' && entry.init && ['ArrowFunctionExpression', 'FunctionExpression'].includes(entry.init.type))
            || entry.type === 'MethodDefinition'
          )
        ));
        const callerName = enclosing?.id?.name
          ?? (enclosing?.type === 'MethodDefinition' && enclosing.key?.type === 'Identifier' ? enclosing.key.name : null)
          ?? '(module)';
        calls.push(Object.freeze({ callerName, calleeName, line: node.loc.start.line }));
      },
    });

    return Object.freeze({
      filePath,
      hash,
      error: null,
      symbols: Object.freeze(symbols),
      imports: Object.freeze(imports.map((entry) => Object.freeze(entry))),
      exports: Object.freeze(exports.map((entry) => Object.freeze(entry))),
      calls: Object.freeze(calls),
    });
  }

  return Object.freeze({ parseFile, validate, fileHash });
}
