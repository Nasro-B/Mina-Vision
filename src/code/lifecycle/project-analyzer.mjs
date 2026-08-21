// Cycle de vie T3.1 (SPEC agente-codage V3) : cartographie un projet INCONNU → stack détectée, scripts,
// points d'entrée, présence de tests, état git. Sortie = rapport parlable (« projet Vite+React, tests
// présents, git propre »). Détection déterministe depuis package.json + présence de fichiers ; HONNÊTE
// quand il n'y a pas de tests (ne prétend jamais qu'un projet est testé s'il ne l'est pas). Injectable
// (fs + runCommand) → testable sans disque ni git.

const STACK_SIGNALS = [
  { id: 'vite-react', type: 'web', when: (d) => d.react && (d.vite || d['@vitejs/plugin-react']) },
  { id: 'node-fastify', type: 'api', when: (d) => Boolean(d.fastify) },
  { id: 'node-express', type: 'api', when: (d) => Boolean(d.express) },
  { id: 'electron', type: 'electron', when: (d) => Boolean(d.electron) },
  { id: 'python-fastapi', type: 'api', when: (d) => Boolean(d.fastapi) },
];

export function createProjectAnalyzer({ fs, runCommand } = {}) {
  if (!fs || typeof fs.readJson !== 'function' || typeof fs.exists !== 'function') {
    throw new TypeError('project_analyzer_fs_required');
  }

  function detectStack(pkg) {
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    const hit = STACK_SIGNALS.find((s) => s.when(deps));
    if (hit) return { stack: hit.id, type: hit.type };
    if (pkg.bin) return { stack: 'node-cli', type: 'cli' };
    return { stack: null, type: null }; // inconnu → jamais inventé
  }

  return Object.freeze({
    async analyze(dir) {
      if (!dir) throw new TypeError('project_analyzer_dir_required');
      const pkg = (await fs.readJson(`${dir}/package.json`)) ?? {};
      const { stack, type } = detectStack(pkg);
      const scripts = pkg.scripts ? Object.keys(pkg.scripts) : [];
      const hasTests = Boolean(pkg.scripts?.test) || (await fs.exists(`${dir}/test`)) || (await fs.exists(`${dir}/tests`));
      const entryPoints = [pkg.main, ...(pkg.bin ? Object.values(pkg.bin) : [])].filter(Boolean);

      let git = 'inconnu';
      if (typeof runCommand === 'function') {
        try {
          const status = await runCommand({ command: 'git', args: ['status', '--porcelain'], cwd: dir });
          git = String(status?.stdout ?? '').trim() === '' ? 'propre' : 'modifié';
        } catch { git = 'inconnu'; }
      }

      const analysis = Object.freeze({
        name: pkg.name ?? null, stack, type, scripts: Object.freeze(scripts),
        hasTests, entryPoints: Object.freeze(entryPoints), git,
      });
      return Object.freeze({ ...analysis, report: describe(analysis) });
    },
  });
}

export function describe(a) {
  const stack = a.stack ?? 'stack non reconnue';
  const tests = a.hasTests ? 'tests présents' : '⚠️ AUCUN test détecté';
  const scripts = a.scripts.length ? a.scripts.join(', ') : 'aucun script npm';
  return `Projet ${a.name ? `« ${a.name} » ` : ''}(${stack}${a.type ? `, ${a.type}` : ''}) : ${tests} ; scripts : ${scripts} ; git ${a.git}.`;
}
