// Chargeur de contexte projet : lit les fichiers de gouvernance (MINA.md — le vrai fichier de
// règles de Mina Vision —, AGENTS.md, CLAUDE.md), la configuration, et détecte le framework.
// Tout est fail-soft : fichier absent → null, jamais d'exception. L'arborescence ne suit JAMAIS
// les symlinks et ignore node_modules/.git (règle OOM machine).

const MAX_DOC_CHARS = 64_000;
const IGNORED_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.vercel', 'out']);

const FRAMEWORK_RULES = Object.freeze([
  { name: 'Electron', test: ({ deps }) => 'electron' in deps },
  { name: 'Next.js', test: ({ deps }) => 'next' in deps },
  { name: 'Fastify', test: ({ deps }) => 'fastify' in deps },
  { name: 'Express.js', test: ({ deps }) => 'express' in deps },
  { name: 'Vite', test: ({ deps }) => 'vite' in deps },
  { name: 'React', test: ({ deps }) => 'react' in deps },
  { name: 'Cloudflare Workers', test: ({ files }) => files.has('wrangler.toml') || files.has('wrangler.jsonc') },
  { name: 'Supabase', test: ({ deps }) => Object.keys(deps).some((name) => name.startsWith('@supabase/') || name === 'supabase') },
  { name: 'Prisma', test: ({ deps }) => 'prisma' in deps || '@prisma/client' in deps },
  { name: 'Tailwind CSS', test: ({ deps }) => 'tailwindcss' in deps },
  { name: 'Vitest', test: ({ deps }) => 'vitest' in deps },
  { name: 'Playwright', test: ({ deps }) => 'playwright' in deps || '@playwright/test' in deps },
]);

const joinPath = (root, relative) => `${String(root).replace(/[\\/]+$/u, '')}/${relative}`;

export function createProjectContextLoader({ fileReader } = {}) {
  if (!fileReader || typeof fileReader.readFile !== 'function' || typeof fileReader.readdir !== 'function') {
    throw new TypeError('project_context_loader_file_reader_required');
  }

  async function readIfExists(projectRoot, relative) {
    try {
      const content = await fileReader.readFile(joinPath(projectRoot, relative), 'utf8');
      const text = String(content);
      return text.length > MAX_DOC_CHARS ? `${text.slice(0, MAX_DOC_CHARS)}…[tronqué]` : text;
    } catch {
      return null;
    }
  }

  async function readJsonIfExists(projectRoot, relative) {
    const text = await readIfExists(projectRoot, relative);
    if (text === null) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  async function firstExisting(projectRoot, candidates) {
    for (const candidate of candidates) {
      const content = await readIfExists(projectRoot, candidate);
      if (content !== null) return Object.freeze({ file: candidate, content });
    }
    return null;
  }

  async function listProjectTree(projectRoot, { maxDepth = 2 } = {}) {
    const entries = [];
    async function walk(relative, depth) {
      if (depth > maxDepth) return;
      let dirents;
      try {
        dirents = await fileReader.readdir(relative === '' ? projectRoot : joinPath(projectRoot, relative), { withFileTypes: true });
      } catch {
        return;
      }
      for (const dirent of dirents) {
        if (typeof dirent.isSymbolicLink === 'function' && dirent.isSymbolicLink()) continue;
        const isDirectory = typeof dirent.isDirectory === 'function' ? dirent.isDirectory() : false;
        const name = dirent.name;
        if (isDirectory && IGNORED_DIRECTORIES.has(name)) continue;
        const path = relative === '' ? name : `${relative}/${name}`;
        entries.push(isDirectory ? `${path}/` : path);
        if (isDirectory) await walk(path, depth + 1);
      }
    }
    await walk('', 1);
    return Object.freeze(entries.sort());
  }

  return Object.freeze({
    async load(projectRoot) {
      if (typeof projectRoot !== 'string' || projectRoot.length === 0) {
        throw new Error('project_context_loader_root_required');
      }
      const packageJson = await readJsonIfExists(projectRoot, 'package.json');
      const tree = await listProjectTree(projectRoot, { maxDepth: 2 });
      const rootFiles = new Set(tree.filter((entry) => !entry.includes('/')));

      const deps = Object.freeze({
        ...(packageJson?.dependencies ?? {}),
        ...(packageJson?.devDependencies ?? {}),
      });
      const frameworks = FRAMEWORK_RULES
        .filter((rule) => {
          try {
            return rule.test({ deps, files: rootFiles });
          } catch {
            return false;
          }
        })
        .map((rule) => rule.name);

      return Object.freeze({
        minaMd: await readIfExists(projectRoot, 'MINA.md'),
        agentsMd: await readIfExists(projectRoot, 'AGENTS.md'),
        claudeMd: await readIfExists(projectRoot, 'CLAUDE.md'),
        codexMd: await readIfExists(projectRoot, '.codex/AGENTS.md'),
        packageJson,
        tsconfig: await readJsonIfExists(projectRoot, 'tsconfig.json'),
        gitignore: await readIfExists(projectRoot, '.gitignore'),
        eslintConfig: await firstExisting(projectRoot, [
          'eslint.config.mjs', 'eslint.config.js', '.eslintrc.json', '.eslintrc.cjs', '.eslintrc.js', '.eslintrc',
        ]),
        prettierConfig: await firstExisting(projectRoot, [
          '.prettierrc', '.prettierrc.json', '.prettierrc.js', 'prettier.config.mjs', 'prettier.config.js',
        ]),
        vitestConfig: await firstExisting(projectRoot, [
          'vitest.config.mjs', 'vitest.config.ts', 'vitest.config.js',
        ]),
        readme: await readIfExists(projectRoot, 'README.md'),
        changelog: await readIfExists(projectRoot, 'CHANGELOG.md'),
        envExample: await readIfExists(projectRoot, '.env.example'),
        tree,
        framework: frameworks[0] ?? null,
        frameworks: Object.freeze(frameworks),
        scripts: Object.freeze({ ...(packageJson?.scripts ?? {}) }),
        dependencies: deps,
      });
    },
  });
}
