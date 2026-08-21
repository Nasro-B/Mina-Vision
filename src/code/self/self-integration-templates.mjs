// Auto-modification T4.4 (SPEC agente-codage V4) : gabarits d'intégration pour que « s'ajouter un outil »
// atterrisse au BON endroit. Chaque gabarit produit le module ET son TEST — un point d'intégration sans
// test ne peut pas passer le gate (invariant : `files` contient TOUJOURS une entrée `tests/…`). Les points
// d'ancrage qui touchent des fichiers partagés (déclaration LIVE_TOOLS, catalogue, contrat jsdom) sont
// INDIQUÉS mais jamais écrits en aveugle — le self-change-orchestrator les applique avec confirmation.
// Module PUR : renvoie des chaînes de fichiers, aucune I/O.

function kebab(name) {
  const k = String(name ?? '').normalize('NFD').replace(/[̀-ͯ]/gu, '').toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 48);
  if (!k) throw new TypeError('integration_template_name_required');
  return k;
}
function camel(k) { return k.replace(/-([a-z0-9])/gu, (_, c) => c.toUpperCase()); }

export function createIntegrationTemplates() {
  return Object.freeze({
    // Nouvel outil (fonction pure) + son test. Ancrage : LIVE_TOOLS + handler + dédup intents.
    tool({ name, description = '' } = {}) {
      const k = kebab(name); const fn = camel(k);
      return Object.freeze({
        kind: 'tool',
        files: Object.freeze({
          [`src/tools/${k}.mjs`]: `// Outil « ${k} »${description ? ` — ${description}` : ''} (ajouté par auto-modification).\nexport function ${fn}(input = {}) {\n  return { tool: '${k}', ok: true, echo: input };\n}\n`,
          [`tests/${k}.test.mjs`]: `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { ${fn} } from '../src/tools/${k}.mjs';\n\ntest('${k} renvoie un résultat structuré', () => {\n  assert.equal(${fn}({ x: 1 }).ok, true);\n});\n`,
        }),
        anchors: Object.freeze(['LIVE_TOOLS (déclaration)', 'handler voix', 'dédup intents (couche déterministe)']),
      });
    },

    // Nouveau domaine composé + son test. Ancrage : catalogue de capacités.
    domain({ name } = {}) {
      const k = kebab(name); const fn = camel(k);
      return Object.freeze({
        kind: 'domain',
        files: Object.freeze({
          [`src/${k}/compose-${k}-domain.mjs`]: `// Domaine « ${k} » composé (ajouté par auto-modification). Fail-honest : état lisible.\nexport function compose${fn[0].toUpperCase()}${fn.slice(1)}Domain({ ready = false } = {}) {\n  return Object.freeze({ state: ready ? 'operational' : 'degraded', reason: ready ? null : 'non_configure' });\n}\n`,
          [`tests/compose-${k}-domain.test.mjs`]: `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { compose${fn[0].toUpperCase()}${fn.slice(1)}Domain } from '../src/${k}/compose-${k}-domain.mjs';\n\ntest('${k} est honnête sur son état', () => {\n  assert.equal(compose${fn[0].toUpperCase()}${fn.slice(1)}Domain({}).state, 'degraded');\n});\n`,
        }),
        anchors: Object.freeze(['catalogue de capacités', 'composition au boot (main.mjs)']),
      });
    },

    // Nouvelle page UI (logique pure du contrôleur) + son test. Ancrage : index.html/renderer/styles.
    uiPage({ name } = {}) {
      const k = kebab(name); const fn = camel(k);
      return Object.freeze({
        kind: 'ui_page',
        files: Object.freeze({
          [`src/ui/pages/${k}-controller.mjs`]: `// Contrôleur de page « ${k} » (logique PURE, ajouté par auto-modification).\nexport function ${fn}Summary(state = {}) {\n  return { page: '${k}', items: Array.isArray(state.items) ? state.items.length : 0 };\n}\n`,
          [`tests/${k}-controller.test.mjs`]: `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { ${fn}Summary } from '../src/ui/pages/${k}-controller.mjs';\n\ntest('${k} résume l’état', () => {\n  assert.equal(${fn}Summary({ items: [1, 2] }).items, 2);\n});\n`,
        }),
        anchors: Object.freeze(['index.html (markup)', 'renderer.js (câblage)', 'styles.css (tokens)', 'contrat jsdom']),
      });
    },
  });
}
