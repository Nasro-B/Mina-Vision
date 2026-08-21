// Genèse T1.2 (SPEC agente-codage V1) : catalogue VERSIONNÉ de stacks éprouvées. Chaque stack décrit un
// squelette DÉTERMINISTE et audité (arborescence + contenu réel des fichiers) — zéro `npx create-*`
// aveugle. Une stack inconnue n'est jamais inventée : `closestStack` propose la plus proche et le DIT.
// Le premier test de chaque squelette est PUR (`node --test`, aucune dépendance) → « premier test vert »
// fiable même avant/malgré l'installation des vraies dépendances. Module PUR : aucune I/O ici (l'écriture
// est faite par project-scaffolder T1.3).

export const STACK_CATALOG_VERSION = '1.0.0';

const GITIGNORE = 'node_modules/\ndist/\n.env\n*.log\n';

function pkg(name, extra = {}) {
  return `${JSON.stringify({ name, version: '0.1.0', type: 'module', scripts: { test: 'node --test' }, ...extra }, null, 2)}\n`;
}

const NODE_CLI = Object.freeze({
  id: 'node-cli',
  version: '1.0.0',
  type: 'cli',
  description: 'Outil en ligne de commande Node (ESM), testé avec le runner natif node:test.',
  testCommand: 'npm test',
  installCommand: 'npm install',
  files: Object.freeze({
    'package.json': pkg('node-cli-app', { bin: { app: 'src/index.mjs' } }),
    'src/index.mjs': "export function greet(name) {\n  return `Bonjour, ${String(name ?? 'monde')}.`;\n}\n\nif (import.meta.url === `file://${process.argv[1]}`) {\n  console.log(greet(process.argv[2]));\n}\n",
    'test/index.test.mjs': "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { greet } from '../src/index.mjs';\n\ntest('greet salue par le nom', () => {\n  assert.equal(greet('Nasro'), 'Bonjour, Nasro.');\n});\n",
    '.gitignore': GITIGNORE,
    'README.md': '# node-cli-app\n\nOutil CLI Node (ESM). `npm test` (runner natif) doit être vert.\n',
  }),
});

const NODE_FASTIFY = Object.freeze({
  id: 'node-fastify',
  version: '1.0.0',
  type: 'api',
  description: 'API HTTP Fastify (ESM). La logique testable (payloads) est pure ; le serveur utilise fastify.',
  testCommand: 'npm test',
  installCommand: 'npm install',
  files: Object.freeze({
    'package.json': pkg('fastify-api', { dependencies: { fastify: '^5.0.0' } }),
    // Logique PURE (testée sans démarrer le serveur ni installer fastify) — les vraies routes s'ajoutent
    // ensuite par cycles TDD (T1.4).
    'src/health.mjs': "export function healthPayload() {\n  return { status: 'ok', service: 'fastify-api' };\n}\n",
    'src/server.mjs': "import Fastify from 'fastify';\nimport { healthPayload } from './health.mjs';\n\nexport function buildServer() {\n  const app = Fastify({ logger: false });\n  app.get('/health', async () => healthPayload());\n  return app;\n}\n\nif (import.meta.url === `file://${process.argv[1]}`) {\n  buildServer().listen({ port: 3000, host: '127.0.0.1' });\n}\n",
    'test/health.test.mjs': "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { healthPayload } from '../src/health.mjs';\n\ntest('health renvoie ok', () => {\n  assert.deepEqual(healthPayload(), { status: 'ok', service: 'fastify-api' });\n});\n",
    '.gitignore': GITIGNORE,
    'README.md': '# fastify-api\n\nAPI Fastify (ESM). `npm install` puis `npm test` (runner natif) doit être vert.\n',
  }),
});

const VITE_REACT = Object.freeze({
  id: 'vite-react',
  version: '1.0.0',
  type: 'web',
  description: 'Application web Vite + React. La logique pure (composants purs/utils) est testée sans DOM.',
  testCommand: 'npm test',
  installCommand: 'npm install',
  files: Object.freeze({
    'package.json': pkg('vite-react-app', { dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' }, devDependencies: { vite: '^6.0.0', '@vitejs/plugin-react': '^4.0.0' } }),
    'index.html': '<!doctype html>\n<html lang="fr">\n  <head><meta charset="utf-8" /><title>vite-react-app</title></head>\n  <body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body>\n</html>\n',
    'src/format.mjs': "export function greeting(name) {\n  return `Bienvenue, ${String(name ?? 'invité')}.`;\n}\n",
    'src/App.jsx': "import { greeting } from './format.mjs';\n\nexport default function App() {\n  return <h1>{greeting('Nasro')}</h1>;\n}\n",
    'src/main.jsx': "import { createRoot } from 'react-dom/client';\nimport App from './App.jsx';\n\ncreateRoot(document.getElementById('root')).render(<App />);\n",
    'test/format.test.mjs': "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { greeting } from '../src/format.mjs';\n\ntest('greeting est pur et lisible', () => {\n  assert.equal(greeting('Nasro'), 'Bienvenue, Nasro.');\n});\n",
    '.gitignore': GITIGNORE,
    'README.md': '# vite-react-app\n\nApp Vite + React. `npm install`, `npm run dev` pour lancer, `npm test` (runner natif) pour la logique pure.\n',
  }),
});

const STACKS = Object.freeze({
  'node-cli': NODE_CLI,
  'node-fastify': NODE_FASTIFY,
  'vite-react': VITE_REACT,
});

export function listStacks() {
  return Object.freeze(Object.keys(STACKS));
}

export function getStack(id) {
  return STACKS[id] ?? null;
}

// Stack inconnue → suggestion DÉTERMINISTE de la plus proche + raison ; jamais d'invention silencieuse.
export function closestStack(id) {
  const text = String(id ?? '').toLowerCase();
  if (/(api|fastify|express|serveur|server|http|rest|backend)/u.test(text)) return Object.freeze({ suggestion: 'node-fastify', reason: 'ressemble à une API HTTP' });
  if (/(react|vue|svelte|web|vite|front|site|page|ui)/u.test(text)) return Object.freeze({ suggestion: 'vite-react', reason: 'ressemble à une app web' });
  if (/(cli|command|outil|script|terminal)/u.test(text)) return Object.freeze({ suggestion: 'node-cli', reason: 'ressemble à un outil en ligne de commande' });
  return Object.freeze({ suggestion: 'node-cli', reason: 'stack inconnue — proposition par défaut la plus simple' });
}
