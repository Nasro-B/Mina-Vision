import path from 'node:path';

// Genèse T1.3 (SPEC agente-codage V1) : écrit un squelette de stack sur disque, puis prouve qu'il TOURNE.
// Ordre : (1) refuse d'écraser un dossier NON VIDE sans confirmation propriétaire ; (2) écrit chaque
// fichier de façon ATOMIQUE (temp + rename, via l'implémentation fs injectée) ; (3) git init + commit
// initial ; (4) npm install (borné) ; (5) lance le premier test — VERT obligatoire avant de déclarer
// « projet créé » (`ready`). Tout est INJECTÉ (fs, runCommand, confirm) → testable sans disque, git ni npm.
// Honnête : si le test échoue, `ready:false` et on le DIT — jamais « créé » sur une preuve absente.

const INITIAL_COMMIT_MESSAGE = 'chore: genèse initiale du projet (créé par Mina Vision)';

export function createProjectScaffolder({ fs, runCommand, confirm = async () => false, now = () => Date.now() } = {}) {
  if (!fs || ['exists', 'isEmptyDir', 'mkdirp', 'writeFileAtomic'].some((m) => typeof fs[m] !== 'function')
    || typeof runCommand !== 'function') {
    throw new TypeError('project_scaffolder_dependencies_required');
  }

  async function run(command, args, cwd) {
    const result = await runCommand({ command, args, cwd });
    return { code: Number(result?.code ?? 0), stdout: String(result?.stdout ?? ''), stderr: String(result?.stderr ?? '') };
  }

  return Object.freeze({
    async scaffold({ brief, stack } = {}) {
      if (!brief?.targetDir || !stack?.files || typeof stack.files !== 'object') {
        throw new TypeError('project_scaffolder_brief_and_stack_required');
      }
      const dir = path.resolve(brief.targetDir);

      // (1) Garde-fou anti-écrasement : un dossier non vide n'est jamais écrasé sans OK explicite.
      if ((await fs.exists(dir)) && !(await fs.isEmptyDir(dir))) {
        const approved = await confirm({ reason: `Le dossier « ${dir} » n'est pas vide — écrire dedans ?`, action: { name: 'genesis.scaffold', targetDir: dir } });
        if (approved !== true) {
          return Object.freeze({ ready: false, created: false, reason: 'target_not_empty_refused', path: dir });
        }
      }

      // (2) Écriture atomique de tout le squelette.
      const written = [];
      for (const [relative, content] of Object.entries(stack.files)) {
        const full = path.join(dir, relative);
        await fs.mkdirp(path.dirname(full));
        await fs.writeFileAtomic(full, String(content));
        written.push(relative);
      }

      // (3) git init + commit initial.
      await run('git', ['init'], dir);
      await run('git', ['add', '.'], dir);
      const commit = await run('git', ['commit', '-m', INITIAL_COMMIT_MESSAGE], dir);

      // (4) Installation des dépendances (bornée par la policy réseau côté runCommand).
      const install = await run('npm', ['install'], dir);

      // (5) Premier test — VERT obligatoire avant de déclarer le projet créé.
      const test = await run('npm', ['test'], dir);
      const testPassed = test.code === 0;

      return Object.freeze({
        ready: testPassed, // « projet créé » seulement si le premier test est vert
        created: true, // les fichiers ont bien été écrits (distinct de ready)
        path: dir,
        stackId: stack.id ?? null,
        filesWritten: Object.freeze(written),
        gitCommitted: commit.code === 0,
        installOk: install.code === 0,
        testPassed,
        at: now(),
      });
    },
  });
}
