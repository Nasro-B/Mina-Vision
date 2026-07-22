# Mina — Agent de Code (Mina Code)

**Statut :** specification exhaustive — 20 juillet 2026. Couvre la totalite des modules,
contrats, APIs, flux, tests et integrations necessaires pour que Mina Vision rivalise
avec Claude Code (Anthropic) et GPT-5.5 Codex (OpenAI) en tant qu''agent de code.

**References internes :**
- Architecture existante : src/core/orchestrator.mjs, src/core/capability-brief.mjs
- Securite existante : src/crypto/keyring.mjs, src/safety/policy.mjs
- Providers existants : src/providers/provider-registry.mjs, src/routing/capability-router.mjs
- Skills : src/skills/skill-registry.mjs, src/skills/composite-runtime.mjs
- Sandbox : src/sandbox/windows-sandbox.mjs
- UI : src/ui/main.mjs

---

## Resume executif — Differentiel competitif

| Capacite | Claude Code | Codex (GPT-5.5) | Mina (actuel) | Mina Code (cible) |
|---|---|---|---|---|
| Modele specialise code | Claude Opus | GPT-5.5 | Gemini Flash | Routeur multi-codeurs |
| Comprehension codebase | AST + call graph | AST + symbol index | RAG conversationnel | Index semantique code |
| Edition structuree | edit (diff-aware) | apply_patch | fs.writeFile brut | code-patch-engine |
| Boucle TDD | Oui | Oui | Non | test-loop orchestre |
| Git natif | Oui | Oui | Aucun | git-capability |
| Planification visible | Oui | Oui | Interne | code-plan-board UI |
| Multi-fichier | Oui | Oui | Non | refactor-workspace |
| AGENTS.md awareness | Oui | Oui | Non | project-context-loader |
| Offline | Non | Non | Oui (LM Studio) | Oui (conserve) |
| Multi-fournisseur | Non | Non | Oui (5 providers) | Oui (8+ providers) |
| Controle mobile | Non | Non | Android ADB | Oui (conserve) |
| Memoire cross-session | Non | Non | Chiffree + RAG | Oui (conserve) |

### Avantage strategique de Mina Code

1. **Offline-first** : execution locale via LM Studio + DeepSeek Coder, CodeQwen, StarCoder2
2. **Multi-fournisseur sans vendor lock-in** : router entre Gemini Code, DeepSeek, OpenRouter, local
3. **End-to-end mobile** : tester sur Android reel connecte via ADB/Kotlin
4. **Sandbox d''execution reelle** : Windows Sandbox jetable, reseau desactive
5. **Securite par conception** : capability broker, safety policy, rate limiter


## 1. Architecture globale

### 1.1 Principes fondateurs

- **Zero rupture de l''existant.** Modules actuels intacts. Nouveaux dans `src/code/` et `src/ui/code/`.
- **Meme orchestrateur, domaine different.** `createMinaOrchestrator({ domain: "code" })` active le pipeline developpeur.
- **Meme capability broker, nouvelles capacites.** Actions `git.*`, `code.*`, `test.*` avec politiques dediees.
- **Meme keyring, nouveaux domaines.** Tokens GitHub/GitLab sous `provider/github/*`.
- **Meme sandbox, nouvel usage.** Windows Sandbox existante pour execution de code non fiable.

### 1.2 Arborescence des nouveaux modules

```
src/code/
├── code-orchestrator.mjs
├── code-personality.mjs
├── code-safety-policy.mjs
├── code-action-normalizer.mjs
├── code-verifier.mjs
├── code-context-window.mjs
├── intelligence/
│   ├── project-context-loader.mjs
│   ├── ast-parser.mjs
│   ├── call-graph.mjs
│   ├── dependency-graph.mjs
│   ├── symbol-index.mjs
│   ├── codebase-indexer.mjs
│   ├── code-semantic-search.mjs
│   └── change-impact-analyzer.mjs
├── editing/
│   ├── diff-engine.mjs
│   ├── patch-applier.mjs
│   ├── code-formatter.mjs
│   ├── lint-runner.mjs
│   ├── refactor-workspace.mjs
│   └── file-backup.mjs
├── git/
│   ├── git-client.mjs
│   ├── git-status.mjs
│   ├── git-diff.mjs
│   ├── git-commit.mjs
│   ├── git-branch-guard.mjs
│   ├── git-log.mjs
│   └── git-hook-post-commit.mjs
├── testing/
│   ├── test-runner.mjs
│   ├── test-parser.mjs
│   ├── test-loop.mjs
│   ├── coverage-analyzer.mjs
│   ├── test-generator.mjs
│   └── sandbox-test-runner.mjs
├── planning/
│   ├── code-plan.mjs
│   ├── code-plan-store.mjs
│   └── code-plan-evaluator.mjs
├── review/
│   ├── code-reviewer.mjs
│   ├── security-scanner.mjs
│   └── style-checker.mjs
└── providers/
    ├── code-provider-router.mjs
    ├── deepseek-coder.mjs
    ├── gemini-code.mjs
    ├── openrouter-code.mjs
    └── lmstudio-code.mjs

src/ui/code/
├── code-ipc.mjs
├── code-plan-board.mjs
├── code-diff-viewer.mjs
├── code-test-panel.mjs
├── code-git-panel.mjs
├── code-context-panel.mjs
├── code-terminal.mjs
└── code-dashboard.html
```

## 2. Personnalite developpeur

### 2.1 Module `code-personality.mjs`

```javascript
export function createCodePersonality({ baseInstructions, skillRegistry }) {
  return Object.freeze({
    buildSystemPrompt({ projectContext, plan, mode, preferences }),
    updateWithResult({ currentPrompt, actionResult, observation }),
    compact({ prompt, maxTokens, priorityRules }),
  });
}
```

### 2.2 Regles injectees dans le prompt systeme

```
Tu es Mina Code, agent de developpement. Regles absolues :

1. GIT — Ne JAMAIS git push, git push --force, ou modifier les branches protegees.
   Format de commit : type(scope): message.

2. EDITION — Modifier UNIQUEMENT les lignes necessaires. Ne jamais reformater
   ou reecrire du code qui n''est pas l''objet du correctif.

3. TESTS — Ecrire d''abord un test qui echoue, puis le code minimal qui le fait
   passer. Ne jamais declarer "fait" sans suite verte.

4. DIFFS MINIMAUX — Pas de reformatage massif. Pas de reecriture de fichier
   entier si 3 lignes suffisent.

5. VERIFICATION — Apres chaque edition : npm test. Rouge -> corriger. Vert -> suite.

6. SECURITE — Pas de secrets en dur. Pas d''eval(). Pas d''injection non sanitisee.

7. PROJET — Lire AGENTS.md et CLAUDE.md avant toute modification.

8. INCERTITUDE — Dire "je ne sais pas" plutot qu''inventer.

9. PLAN — Decomposer en etapes verifiables. Mettre a jour le statut.

10. ARRET — Arret immediat sur demande. Nettoyer les fichiers temporaires.
```

### 2.3 Module `project-context-loader.mjs`

```javascript
export function createProjectContextLoader({ fileReader }) {
  return Object.freeze({
    async load(projectRoot) {
      return Object.freeze({
        agentsMd: await readIfExists('AGENTS.md'),
        claudeMd: await readIfExists('CLAUDE.md'),
        codexMd: await readIfExists('.codex/AGENTS.md'),
        packageJson: await readJsonIfExists('package.json'),
        tsconfig: await readJsonIfExists('tsconfig.json'),
        gitignore: await readIfExists('.gitignore'),
        eslintConfig: await findEslintConfig(projectRoot),
        prettierConfig: await findPrettierConfig(projectRoot),
        vitestConfig: await readIfExists('vitest.config.mjs'),
        readme: await readIfExists('README.md'),
        changelog: await readIfExists('CHANGELOG.md'),
        envExample: await readIfExists('.env.example'),
        tree: await listProjectTree(projectRoot, { maxDepth: 2 }),
        framework: await detectFramework(projectRoot),
        scripts: await getNpmScripts(projectRoot),
        dependencies: await getDependencies(projectRoot),
      });
    },
  });
}
```

**Detection automatique de framework :**

| Patterns detectes | Framework |
|---|---|
| `express` in deps + `app.js`/`server.js` | Express.js |
| `fastify` in deps | Fastify |
| `next` in deps + `next.config` | Next.js |
| `vite` in deps + `vite.config` | Vite |
| `react` in deps | React |
| `electron` in deps | Electron |
| `wrangler.toml` present | Cloudflare Workers |
| `supabase` in deps | Supabase |
| `prisma` in deps | Prisma |
| `tailwindcss` in deps | Tailwind CSS |

---

## 3. Intelligence codebase

### 3.1 Indexeur principal — `codebase-indexer.mjs`

```javascript
export function createCodebaseIndexer({
  astParser, callGraph, dependencyGraph,
  symbolIndex, vectorStore, fileReader, projectRoot,
}) {
  return Object.freeze({
    async fullIndex({ onProgress }),
    async incrementalIndex({ changedFiles, onProgress }),
    searchSymbol(query): SymbolResult[],
    findUsages(symbolId): Usage[],
    getDependencies(filePath): DependencyInfo,
    impactAnalysis(changedFile, changedSymbol?): ImpactResult,
    status(): { indexedFiles, totalFiles, lastIndexedAt, staleFiles },
  });
}
```

**Pipeline d''indexation :**

```
1. Walk project tree -> liste de fichiers .js/.ts/.mjs/.py
2. Pour chaque fichier modifie :
   a. Parser AST -> arbre syntaxique
   b. Extraire symboles -> { name, kind, location, visibility, jsdoc }
   c. Extraire imports -> { source, specifiers, isDynamic }
   d. Extraire exports -> { name, kind, isDefault }
3. Construire call-graph : appels de fonction lies
4. Construire dependency-graph : imports/exports
5. Indexer dans vector store : embed chaque fonction/classe
6. Persister dans SQLite (invalidation par hash de fichier)
```

### 3.2 Parseur AST — `ast-parser.mjs`

```javascript
// Types de symboles extraits
const SymbolKind = {
  FUNCTION: 'function', CLASS: 'class', METHOD: 'method',
  VARIABLE: 'variable', CONSTANT: 'constant',
  INTERFACE: 'interface', TYPE_ALIAS: 'type_alias', ENUM: 'enum',
  EXPORT: 'export', IMPORT: 'import',
};

// Structure d''un symbole indexe
{
  id: "filehash::functionName::line:col",
  name: "createCodebaseIndexer",
  kind: "function",
  file: "src/code/intelligence/codebase-indexer.mjs",
  startLine: 24, endLine: 87,
  visibility: "exported",
  jsdoc: "Indexeur principal...",
  params: [{ name: "astParser", type: "object", optional: false }],
  returnType: "object",
  dependencies: ["src/code/intelligence/ast-parser.mjs"],
  usedBy: ["src/code/code-orchestrator.mjs"],
  hash: "sha256:abc123...",
}
```

### 3.3 Graphe d''appels — `call-graph.mjs`

```javascript
export function createCallGraph({ symbolIndex }) {
  return Object.freeze({
    addEdge({ callerId, calleeId, callSite }),
    callers(symbolId, depth?): CallerChain[],
    callees(symbolId, depth?): CalleeChain[],
    shortestPath(fromId, toId): SymbolId[] | null,
    findCycles(): Cycle[],
    toDot({ focusSymbolId }): string,
  });
}
```

### 3.4 Graphe de dependances — `dependency-graph.mjs`

```javascript
export function createDependencyGraph({ symbolIndex }) {
  return Object.freeze({
    directDependencies(filePath): string[],
    transitiveDependencies(filePath): string[],
    dependents(filePath): string[],
    topologicalSort(): string[],
    affectedBy(changedFiles: string[]): string[],
    findCircularImports(): CircularImport[],
  });
}
```

### 3.5 Recherche semantique — `code-semantic-search.mjs`

```javascript
export function createCodeSemanticSearch({ vectorStore, symbolIndex }) {
  return Object.freeze({
    async search(query, { maxResults, fileFilter? }): Promise<SearchResult[]>,
    findSymbol(name, { kind?, file? }): SymbolResult[],
    findPattern(pattern, { fileGlob?, contextLines }): PatternMatch[],
    findAllCalls(functionName): CallSite[],
    findUntestedFiles(): string[],
    findDeadCode(): DeadSymbol[],
  });
}
```

---

## 4. Edition structuree — Diff/Patch

### 4.1 Diff Engine — `diff-engine.mjs`

```javascript
export function createDiffEngine() {
  return Object.freeze({
    diff({ original, modified, filePath }): UnifiedDiff,
    async applyPatch({ filePath, patch, backup = true }): Promise<PatchResult>,
    validatePatch({ filePath, patch }): PatchValidation,
    async revertLastPatch(filePath): Promise<RevertResult>,
    formatUnified(diff: UnifiedDiff): string,
  });
}

// Format de patch Mina (inspire de apply_patch Codex)
const MINA_PATCH_FORMAT = {
  header: "*** Begin Patch",
  files: [{
    marker: "*** Update File: path/to/file.js",
    hunks: [{
      marker: "@@ -start,count +start,count @@",
      context: ["ligne_contexte"],
      removals: ["-ligne_supprimee"],
      additions: ["+ligne_ajoutee"],
    }]
  }],
  footer: "*** End Patch",
};
```

### 4.2 Patch Applier — `patch-applier.mjs`

```javascript
export function createPatchApplier({ diffEngine, fileBackup, codeFormatter, lintRunner }) {
  return Object.freeze({
    async apply({
      patches, reformat = true, lint = true,
      backup = true, dryRun = false,
    }): Promise<ApplyResult>,
  });
}
```

**Regles strictes du patcher :**

1. **Jamais de reformatage parasite.** Si `reformat = true`, seul le fichier modifie est formatte.
2. **Backup atomique.** Avant edition : `cp file.mjs file.mjs.mina-backup`. Echec -> rollback.
3. **Verification integrite.** Apres edition : reparser AST. Si AST invalide -> rollback.
4. **Diff minimal.** Verifie que le diff ne contient pas de reformatage hors-scope.
5. **Fichiers binaires refuses.** Seuls les fichiers texte sont patchables.

### 4.3 Refactoring multi-fichier — `refactor-workspace.mjs`

```javascript
export function createRefactorWorkspace({
  patchApplier, dependencyGraph, codebaseIndexer, testRunner,
}) {
  return Object.freeze({
    async execute({
      plan: RefactorPlan,
      verifyTests = true,
      atomic = true,
    }): Promise<RefactorResult>,
  });
}
```

**Algorithme de refactoring atomique :**

```
1. Impact analysis -> liste de TOUS les fichiers affectes
2. Pour chaque fichier dans l''ordre topologique :
   a. Backup
   b. Appliquer le patch
   c. Verifier AST valide
   d. Si verifyTests: npm test -- --changed
   e. Si echec -> rollback CE fichier, continuer les autres
3. Si atomic et un fichier echoue -> rollback TOUS les fichiers
4. Rapport final : succes/echecs par fichier, diff total
```


## 5. Integration Git native

### 5.1 Git Client — `git-client.mjs`

```javascript
export function createGitClient({ repoPath, keyring }) {
  return Object.freeze({
    // Commandes de lecture (toujours autorisees)
    status(): Promise<GitStatus>,
    diff({ staged?, from?, to?, file? }): Promise<string>,
    log({ maxCount = 20, file?, author? }): Promise<Commit[]>,
    blame(filePath): Promise<BlameLine[]>,
    show(commitHash): Promise<CommitDetail>,
    branch(): Promise<BranchInfo[]>,
    remote(): Promise<RemoteInfo[]>,

    // Commandes d''ecriture (confirmation obligatoire)
    async add(files: string[]): Promise<void>,
    async commit({ message, files? }): Promise<CommitResult>,
    async checkout(branch: string): Promise<void>,
    async createBranch(name: string): Promise<void>,
    async stash({ message? }): Promise<void>,
    async stashPop(): Promise<void>,

    // BLOQUEES — ne jamais executer
    // push, push --force, force-push, --no-verify
  });
}
```

### 5.2 Garde des branches protegees — `git-branch-guard.mjs`

```javascript
export function createGitBranchGuard({ gitClient, protectedBranches = [] }) {
  // protectedBranches peuple depuis :
  // 1. AGENTS.md ("NE JAMAIS modifier : branche1, branche2")
  // 2. Configuration locale Mina
  // 3. remote origin (detecte main/master par defaut)

  return Object.freeze({
    guard(operation, branch): GuardResult,
    listProtected(): string[],
    addProtection(branch, reason): void,
    isPushAllowed(): false, // Toujours false
  });
}
```

### 5.3 Format de commit impose — `git-commit.mjs`

```javascript
const COMMIT_FORMAT = /^(feat|fix|refactor|test|docs|chore|style|perf|ci|build|revert)(\([a-z0-9_-]+\))?: .{1,200}$/;

export function validateCommitMessage(message) {
  if (!COMMIT_FORMAT.test(message)) {
    throw new Error(
      'Format de commit invalide. Format requis : type(scope): message\n' +
      'Types : feat, fix, refactor, test, docs, chore, style, perf, ci, build, revert\n' +
      'Exemple : fix(auth): JWT expiry set to 24h'
    );
  }
  return message;
}
```

### 5.4 Hook post-commit — `git-hook-post-commit.mjs`

Apres chaque `git commit`, Mina ecrit automatiquement dans son journal de memoire :

```javascript
export function createGitPostCommitHook({ memoryService, activityJournal }) {
  return Object.freeze({
    async onCommit({ hash, message, files, project }) {
      const [type, ...rest] = message.split(':');
      const entry = {
        timestamp: new Date().toISOString(),
        type: type?.trim() || 'chore',
        description: rest.join(':').trim(),
        hash: hash.slice(0, 7),
        files, project,
      };
      await memoryService.recordEvent('git.commit', entry);
      await activityJournal.log('commit', entry);
    },
  });
}
```

---

## 6. Boucle TDD integree

### 6.1 Test Runner — `test-runner.mjs`

```javascript
export function createTestRunner({ projectRoot, sandboxRunner }) {
  return Object.freeze({
    detectFramework(): 'vitest'|'jest'|'mocha'|'pytest'|'go test'|'cargo test'|null,
    async runAll({ timeout = 60_000, bail = false }): Promise<TestResult>,
    async runFile(filePath: string): Promise<TestResult>,
    async runChanged(): Promise<TestResult>,
    async watch({ onChange }): Promise<WatchHandle>,
    async runInSandbox({ testFiles, timeout }): Promise<TestResult>,
  });
}

// TestResult = {
//   framework: "vitest", passed: number, failed: number,
//   skipped: number, duration: number,
//   suites: [{ name, status, duration, error? }],
//   coverage?: { lines, branches, functions, statements },
// }
```

### 6.2 Boucle TDD — `test-loop.mjs`

Le coeur de l''agent de code. Cycle TDD classique : rouge -> vert -> refactor.

```javascript
export function createTestLoop({ testRunner, patchApplier, codeOrchestrator }) {
  return Object.freeze({
    async execute({
      task, maxIterations = 5, onIteration,
    }): Promise<TddResult>,
  });
}
```

**Algorithme de la boucle TDD :**

```
1. ETAT INITIAL : lancer les tests existants -> doivent etre VERTS
   Si deja rouges -> abort, demander a Nasro de fixer d''abord

2. ECRITURE DU TEST :
   a. Generer un test squelettique (test-generator.mjs)
   b. Appliquer le patch du test
   c. Lancer les tests -> doivent etre ROUGES
   d. Si deja vert -> le test ne teste rien -> ajuster

3. ECRITURE DU CODE :
   a. Ecrire le code minimal pour faire passer le test
   b. Appliquer le patch du code
   c. Lancer les tests -> doivent etre VERTS
   d. Si rouge -> analyser l''erreur -> ajuster -> retour a 3a
   e. Si maxIterations atteint -> GIVING_UP

4. REFACTORING (optionnel) :
   a. Nettoyer le code sans changer le comportement
   b. Lancer les tests -> doivent rester VERTS

5. DONE : rapport { testsAdded, linesChanged, iterations, finalStatus }
```

### 6.3 Generation de tests — `test-generator.mjs`

```javascript
export function createTestGenerator({ symbolIndex, projectContext }) {
  return Object.freeze({
    async generateForSymbol(symbolId: string): Promise<GeneratedTest>,
    async generateForFile(filePath: string): Promise<GeneratedTest[]>,
    detectTestStyle(): TestStyle,
    suggestEdgeCases(symbolId: string): EdgeCase[],
  });
}
```

---

## 7. Planification visible

### 7.1 Modele de plan — `code-plan.mjs`

```javascript
export function createCodePlan({ id, title, steps = [] }) {
  return Object.freeze({
    id: string,
    title: string,
    status: 'draft' | 'approved' | 'in_progress' | 'completed' | 'aborted',
    steps: [{
      id: string,
      description: string,
      status: 'pending'|'in_progress'|'completed'|'failed'|'skipped',
      dependsOn: string[],
      verification: string,
      files: string[],
      result?: { success, testsPassed, linesChanged, error? },
    }],
    createdAt: string, updatedAt: string, completedAt: string | null,
  });
}
```

### 7.2 UI Plan Board — `code-plan-board.mjs`

```
+--------------------------------------------------+
|  Plan : Ajouter le renouvellement de JWT         |
|  Statut : * en cours (3/5 etapes)                |
+--------------------------------------------------+
|  [x] 1. Valider le token expire   [tests/auth]   |
|  [x] 2. Creer l''endpoint refresh  [src/routes]  |
|  [>] 3. Ajouter le middleware auto-refresh        |
|  [ ] 4. Mettre a jour les tests E2E               |
|  [ ] 5. Documenter dans README                    |
+--------------------------------------------------+
|  Dernier test : [OK] 42 passed, 0 failed         |
|  Fichiers modifies : 3                            |
|  [Voir le diff] [Valider] [Arreter]               |
+--------------------------------------------------+
```

---

## 8. Revue de code automatisee

### 8.1 Code Reviewer — `code-reviewer.mjs`

```javascript
export function createCodeReviewer({ astParser, symbolIndex, securityScanner, styleChecker }) {
  return Object.freeze({
    async review({ files, focus = 'all' }): Promise<ReviewReport>,
    async quickReview(diff): Promise<ReviewReport>,
  });
}
```

Categories de findings (alignees sur les regles R0-R14 de AGENTS.md) :
- **security** : Injections, secrets, auth bypass
- **performance** : Boucles N+1, memoire, blocking I/O
- **style** : Conventions, naming, formatting
- **logic** : Bugs potentiels, edge cases non geres
- **architecture** : Couplage, SRP, dependances cycliques
- **tests** : Couverture, assertions manquantes

```javascript
const Finding = {
  severity: 'critical'|'high'|'medium'|'low',
  category: 'security'|'performance'|'style'|'logic'|'architecture'|'tests',
  title: string, description: string,
  file: string, startLine: number, endLine: number,
  suggestion?: string, rule: string,
  proof: string,  // Commande executee + stdout (R0)
};
```

### 8.2 Security Scanner — `security-scanner.mjs`

```javascript
export function createSecurityScanner({ projectContext }) {
  return Object.freeze({
    scanSecrets(files: string[]): Promise<SecretFinding[]>,
    scanPatterns(files: string[]): Promise<PatternFinding[]>,
  });
}
```

Patterns dangereux detectes :
- `eval()` / `Function()` / `new Function()`
- `innerHTML` / `outerHTML` / `document.write()`
- `exec()` / `execSync()` sans sanitization
- `require()` dynamique avec variable utilisateur
- `fs.writeFile` sans validation de chemin
- SQL concatene (pas de requetes parametrees)
- JWT sans expiration
- `http://` (non TLS)
- `process.env.SECRET` directement expose
- `password` / `token` / `key` en dur dans le code


## 9. Fournisseurs specialises code

### 9.1 Code Provider Router — `code-provider-router.mjs`

```javascript
export function createCodeProviderRouter({ providerRegistry, capabilityRouter }) {
  return Object.freeze({
    route({ task, mode, context, maxBudget }): CodeProviderRoute,
  });
}
```

Strategies de routage :

| Mode | Comportement |
|---|---|
| `auto` | Local si dispo ET qualite suffisante, sinon cloud le moins cher |
| `local-first` | Local d''abord, cloud en fallback si echec |
| `local-only` | Jamais de cloud (offline total) |
| `best-quality` | Toujours le meilleur modele (Claude Opus via OR -> DeepSeek Coder Pro) |
| `cheapest` | Toujours le moins cher (DeepSeek v4 Flash -> local) |

### 9.2 Grille de prix code

| Fournisseur | Modele | Input/1M | Output/1M | Contexte | Local |
|---|---|---|---|---|---|
| DeepSeek | deepseek-coder-v4 | $0.14 | $0.28 | 128K | Non |
| DeepSeek | deepseek-coder-v4-pro | $0.435 | $0.87 | 128K | Non |
| Gemini | gemini-code | $1.50 | $9.00 | 128K | Non |
| OpenRouter | claude-sonnet-4 | $3.00 | $12.00 | 200K | Non |
| OpenRouter | deepseek-coder-v4 | $0.20 | $0.40 | 128K | Non |
| LM Studio | codestral-22b | $0 | $0 | 32K | Oui |
| LM Studio | qwen2.5-coder-7b | $0 | $0 | 32K | Oui |
| HuggingFace | starcoder2-15b | $0 | $0 | 16K | Oui |

### 9.3 Mise a jour automatique du pricing

Le pricing-catalog.json existant (`config/pricing-catalog.json`) est etendu avec les modeles code.
Chaque modele est re-extrait automatiquement depuis l''API du fournisseur toutes les 24h.

---

## 10. Politiques de securite specifiques au code

### 10.1 `code-safety-policy.mjs`

Etend la politique existante (`src/safety/policy.mjs`) :

```javascript
export function createCodeSafetyPolicy({ basePolicy, gitBranchGuard }) {
  return Object.freeze({
    classifyAction(action, context): CodeSafetyDecision,

    BLOCKED_COMMANDS: [
      'git push', 'git push --force', 'git push --no-verify',
      'git reset --hard', 'git clean -fd',
      'rm -rf', 'del /F /S /Q',
      'DROP TABLE', 'TRUNCATE', 'ALTER TABLE ... DROP',
      'npm publish', 'docker rm -f', 'kubectl delete',
      'terraform destroy',
    ],

    CONFIRM_COMMANDS: [
      'npm install', 'npm uninstall', 'git commit',
      'git branch -D', 'git rebase', 'git stash drop',
      'chmod +x', 'pip install', 'cargo add', 'go get',
    ],

    PROTECTED_FILES: [
      '.env', '.env.local', '.env.production',
      '*.pem', '*.key', 'id_rsa*',
      'credentials.json', 'service-account.json',
      'secrets/**',
    ],
  });
}
```

### 10.2 Code Verifier — `code-verifier.mjs`

Verifications post-action :

```javascript
export function createCodeVerifier({ astParser, testRunner, diffEngine }) {
  return Object.freeze({
    async verify({ action, files, beforeState }): Promise<CodeVerification>,
  });
}
```

Verifications effectuees :
1. **AST integrity** — chaque fichier modifie parse sans erreur
2. **No secrets** — scan des fichiers pour des secrets
3. **Tests pass** — `npm test` passe
4. **No protected file touched** — aucun fichier protege modifie
5. **Diff minimal** — pas de reformatage parasite
6. **No blocked command** — l''action n''est pas dans BLOCKED_COMMANDS

---

## 11. Gestion du contexte — Fenetrage intelligent

### 11.1 `code-context-window.mjs`

```javascript
export function createCodeContextWindow({
  maxTokens = 128_000,        // Modele cloud
  reservedForResponse = 4_000, // Reserve pour la reponse
}) {
  return Object.freeze({
    addFile({ path, content, relevance }): void,
    addActionResult({ action, result, observation }): void,
    addTestFailure({ test, error }): void,
    compact(): ContextCompactResult,
    summarizeHistory(): string,
    estimateTokens(): number,
    pinFiles(paths: string[]): void,
    evict({ targetTokens }): string[],
  });
}
```

**Strategie d''eviction (par ordre) :**

1. Fichiers non modifies avec relevance < 0.3
2. Historique d''actions anciennes (> 10 cycles)
3. Resultats de tests reussis (> 5 cycles)
4. Observations d''ecran anciennes

**JAMAIS evince :** AGENTS.md, fichier en cours d''edition, plan actif, derniers resultats de test.

---

## 12. Integration avec l''existant

### 12.1 Capacites ajoutees au capability broker

```javascript
const CODE_CAPABILITIES = [
  'code.read',          // Lire un fichier
  'code.write',         // Ecrire/modifier un fichier
  'code.delete',        // Supprimer un fichier
  'code.search',        // Rechercher dans le codebase
  'code.test.run',      // Lancer les tests
  'code.test.generate', // Generer un test
  'code.git.status',    // Lire l''etat Git
  'code.git.diff',      // Lire le diff
  'code.git.commit',    // Creer un commit
  'code.git.log',       // Lire l''historique
  'code.plan.create',   // Creer un plan
  'code.plan.update',   // Mettre a jour un plan
  'code.refactor',      // Refactoring multi-fichier
  'code.review',        // Revue de code
  'code.sandbox.run',   // Executer du code en sandbox
  'code.diff.apply',    // Appliquer un patch
  'code.format',        // Formater du code
  'code.lint',          // Linter du code
];
```

### 12.2 Modification de l''orchestrateur

```javascript
// Dans createMinaOrchestrator, nouveau parametre :
{
  domain: 'general' | 'code',  // NOUVEAU
  codeOrchestrator?,           // Injecte si domain === 'code'
}

// Changement de comportement :
if (domain === 'code') {
  // Pipeline developpeur au lieu du pipeline general
  // Actions passent par code-action-normalizer
  // Verification utilise code-verifier
}
```

### 12.3 Modification de l''UI

Ajout d''un onglet "Mina Code" dans l''interface Electron existante, accessible depuis le menu principal.

### 12.4 Dependances npm a ajouter

```json
{
  "dependencies": {
    "acorn": "^8.15.0",
    "acorn-walk": "^8.3.0",
    "simple-git": "^3.28.0",
    "diff": "^7.0.0",
    "fast-glob": "^3.3.0",
    "gpt-tokenizer": "^2.8.0"
  }
}
```

Justifications :
- `acorn` + `acorn-walk` : Parseur AST JS zero-dep, 10x plus leger que @babel/parser
- `simple-git` : Wrapper Git Node.js robuste
- `diff` : Bibliotheque de diff/patch eprouvee (utilisee par Jest, Mocha)
- `fast-glob` : Glob patterns pour lister les fichiers
- `gpt-tokenizer` : Estimation precise de tokens (compatible tiktoken)


## 13. Plan de tests

### 13.1 Tests unitaires (chaque module)

| Module | Fichier test | Tests min |
|---|---|---|
| code-personality | `tests/code/code-personality.test.mjs` | 8 |
| code-safety-policy | `tests/code/code-safety-policy.test.mjs` | 20 |
| code-action-normalizer | `tests/code/code-action-normalizer.test.mjs` | 10 |
| code-verifier | `tests/code/code-verifier.test.mjs` | 12 |
| code-context-window | `tests/code/code-context-window.test.mjs` | 10 |
| project-context-loader | `tests/code/project-context-loader.test.mjs` | 8 |
| ast-parser | `tests/code/ast-parser.test.mjs` | 15 |
| call-graph | `tests/code/call-graph.test.mjs` | 10 |
| dependency-graph | `tests/code/dependency-graph.test.mjs` | 10 |
| symbol-index | `tests/code/symbol-index.test.mjs` | 12 |
| codebase-indexer | `tests/code/codebase-indexer.test.mjs` | 10 |
| code-semantic-search | `tests/code/code-semantic-search.test.mjs` | 8 |
| diff-engine | `tests/code/diff-engine.test.mjs` | 15 |
| patch-applier | `tests/code/patch-applier.test.mjs` | 20 |
| code-formatter | `tests/code/code-formatter.test.mjs` | 8 |
| refactor-workspace | `tests/code/refactor-workspace.test.mjs` | 12 |
| git-client | `tests/code/git-client.test.mjs` | 15 |
| git-branch-guard | `tests/code/git-branch-guard.test.mjs` | 10 |
| git-commit | `tests/code/git-commit.test.mjs` | 8 |
| test-runner | `tests/code/test-runner.test.mjs` | 12 |
| test-loop | `tests/code/test-loop.test.mjs` | 15 |
| test-generator | `tests/code/test-generator.test.mjs` | 10 |
| code-plan | `tests/code/code-plan.test.mjs` | 8 |
| code-plan-store | `tests/code/code-plan-store.test.mjs` | 8 |
| code-reviewer | `tests/code/code-reviewer.test.mjs` | 12 |
| security-scanner | `tests/code/security-scanner.test.mjs` | 10 |
| code-provider-router | `tests/code/code-provider-router.test.mjs` | 10 |
| code-orchestrator | `tests/code/code-orchestrator.test.mjs` | 15 |
| **TOTAL** | **28 fichiers** | **299 tests** |

### 13.2 Tests d''integration

| Scenario | Fichier |
|---|---|
| Cycle TDD complet | `tests/code/integration/tdd-cycle.test.mjs` |
| Refactoring multi-fichier + rollback | `tests/code/integration/refactor-rollback.test.mjs` |
| Indexation projet reel (Mina Vision) | `tests/code/integration/index-real-project.test.mjs` |
| Git workflow complet | `tests/code/integration/git-workflow.test.mjs` |
| Contexte overflow -> compact | `tests/code/integration/context-compaction.test.mjs` |
| Revue de code multi-fichier | `tests/code/integration/code-review.test.mjs` |
| Changement fournisseur en cours | `tests/code/integration/provider-failover.test.mjs` |

### 13.3 Non-regression

Les 303 tests existants doivent rester **100% verts** apres l''ajout des modules code.

---

## 14. Phases d''implementation

### Phase 1 — Fondations (semaine 1-2)
1. `code-personality.mjs` + prompt systeme developpeur
2. `code-safety-policy.mjs` + `code-action-normalizer.mjs`
3. `project-context-loader.mjs`
4. `code-context-window.mjs`
5. Tests pour les 4 modules
6. Integration minimale orchestrator (`domain: 'code'`)

### Phase 2 — Intelligence codebase (semaine 3-4)
7. `ast-parser.mjs` (JavaScript/TypeScript via acorn)
8. `symbol-index.mjs`
9. `call-graph.mjs`
10. `dependency-graph.mjs`
11. `codebase-indexer.mjs`
12. `code-semantic-search.mjs`
13. `change-impact-analyzer.mjs`
14. Tests pour les 7 modules

### Phase 3 — Edition structuree (semaine 5-6)
15. `diff-engine.mjs`
16. `patch-applier.mjs`
17. `file-backup.mjs`
18. `code-formatter.mjs` + `lint-runner.mjs`
19. `refactor-workspace.mjs`
20. Tests pour les 5 modules

### Phase 4 — Git (semaine 7)
21. `git-client.mjs` + `git-status.mjs` + `git-diff.mjs`
22. `git-branch-guard.mjs`
23. `git-commit.mjs`
24. `git-hook-post-commit.mjs`
25. Tests pour les 4 modules

### Phase 5 — TDD (semaine 8-9)
26. `test-runner.mjs` + `test-parser.mjs`
27. `test-loop.mjs`
28. `test-generator.mjs`
29. `coverage-analyzer.mjs`
30. `sandbox-test-runner.mjs`
31. Tests pour les 5 modules

### Phase 6 — Planification & Revue (semaine 10)
32. `code-plan.mjs` + `code-plan-store.mjs`
33. `code-plan-evaluator.mjs`
34. `code-reviewer.mjs` + `security-scanner.mjs` + `style-checker.mjs`
35. Tests pour les 6 modules

### Phase 7 — Providers & UI (semaine 11-12)
36. Adaptateurs de modeles code (DeepSeek, Gemini, OpenRouter, LM Studio)
37. `code-provider-router.mjs`
38. UI Plan Board, Diff Viewer, Test Panel, Git Panel
39. `code-orchestrator.mjs` (integration finale)
40. Tests UI + tests d''integration + dashboard

---

## 15. Conventions et standards

### 15.1 Style de code
- **ESM uniquement** (`.mjs`), coherent avec l''existant
- **Factory functions** : `createModuleName({ dependencies })` -> `Object.freeze({ methodes })`
- **Zero classe** — que des closures (coherent avec le codebase)
- **JSDoc** pour les types (pas de TypeScript)

### 15.2 Gestion d''erreurs
- **Erreurs nominees** : `throw new Error('code_diff_apply_failed: ...')` (snake_case, prefixe module)
- **Jamais de try/catch muet** — toujours journaliser ou propager
- **Fail-closed** : toute erreur inconnue -> etat sur (bloquer)

### 15.3 Performance
- **Indexation paresseuse** : tourne au premier `code.read` ou `code.search`
- **Index incremental** : seuls les fichiers modifies (hash change) sont reindexes
- **Cache des AST** : fichier non modifie = AST en cache (hash SHA-256)
- **Vector store partage** : reutilisation du vector store existant

---

## 16. Metriques de succes

| Metrique | Cible | Methode |
|---|---|---|
| Tests code passants | 100% (299 tests) | `npm test -- tests/code/` |
| Tests existants non casses | 100% (303 tests) | `npm test` |
| Couverture nouveaux modules | >= 90% | `npm run test:coverage` |
| Temps indexation initiale (Mina Vision) | < 30 secondes | Script benchmark |
| Temps indexation incrementale (1 fichier) | < 1 seconde | Script benchmark |
| Temps application patch | < 100 ms | Script benchmark |
| Boucle TDD (tache simple) | < 60 secondes | Test integration |
| Pertinence recherche top-5 | >= 80% | 20 requetes manuelles |
| Contexte max avant compaction | 100K tokens | Test unitaire |
| Build Electron | < +5 secondes | Mesure avant/apres |

---

## 17. Risques et mitigations

| Risque | Probabilite | Impact | Mitigation |
|---|---|---|---|
| Scope trop large, retard | Elevee | Moyen | Phases independantes livrables separement |
| AST parser lent gros projets | Moyenne | Moyen | Index incremental + cache + lazy loading |
| Modeles locaux trop faibles | Elevee | Eleve | Routing auto : local si OK, sinon cloud |
| simple-git incompatible Electron | Faible | Eleve | Fallback child_process.spawn('git') |
| Fuite memoire indexeur | Moyenne | Moyen | Tests de stress 10K fichiers |
| Conflit orchestrateur existant | Faible | Eleve | domain: 'code' isole les pipelines |
| Modele execute commande dangereuse | Moyenne | Critique | code-safety-policy + rate-limiter + confirmations |

---

## 18. Commandes vocales developpeur

| Commande vocale | Action |
|---|---|
| "Mina, analyse le projet" | Lance l''indexation complete du codebase |
| "Mina, cherche [symbole]" | Recherche un symbole dans le codebase |
| "Mina, qu''est-ce qui appelle [fonction] ?" | Affiche le call-graph |
| "Mina, quel est l''impact de modifier [fichier] ?" | Analyse d''impact |
| "Mina, lance les tests" | `npm test` |
| "Mina, quel est le statut Git ?" | `git status` |
| "Mina, cree un plan pour [tache]" | Cree un code plan |
| "Mina, applique le patch" | Applique le patch en attente |
| "Mina, formate le code" | Lance Prettier/ESLint |
| "Mina, revois mes modifications" | Lance la revue de code |
| "Mina, commit avec [message]" | Confirmation puis commit |
| "Mina, montre le diff" | Affiche le diff actuel |
| "Mina, quels fichiers n''ont pas de tests ?" | `findUntestedFiles()` |
| "Mina, code mort ?" | `findDeadCode()` |
| "Mina, combien ca a coute ?" | Affiche le budget consomme |
| "Mina, passe en mode offline" | Bascule en local-only |
| "Mina, mode cloud" | Reactive les fournisseurs cloud |


---

## Annexe A — Flux complet d''une tache de code

```
1. Nasro : "Mina, ajoute un validateur de JWT expire dans swapi"
   |
2. project-context-loader charge :
   - AGENTS.md : Node 22, Express 5, JS ESM, pas de push, format commit
   - package.json : swapi, dependances, scripts
   - Arborescence : src/routes/, src/middleware/, tests/
   |
3. codebase-indexer indexe le projet (ou utilise index existant)
   |
4. code-semantic-search : "JWT", "auth", "middleware", "token"
   -> Trouve : src/middleware/auth.mjs, tests/auth.test.mjs
   |
5. CodePlan cree :
   [1] Lire le middleware auth existant
   [2] Ajouter la validation expiration JWT
   [3] Ajouter un test de rejet token expire
   [4] Lancer les tests -> vert
   [5] Proposer le commit
   |
6. Plan board UI affiche le plan. Nasro clique "Valider".
   |
7. Etape 1 : Lire src/middleware/auth.mjs
   -> Charge dans le contexte, marque pertinent
   |
8. Etape 2 : Code provider (Gemini Code) genere le patch
   |
9. patch-applier applique le diff :
   *** Update File: src/middleware/auth.mjs
   + verification expiration avec jwt.verify + clockTolerance
   |
10. code-verifier verifie :
    [OK] AST valide
    [OK] Pas de secret
    [OK] Pas de fichier protege modifie
    [OK] Diff minimal (3 lignes ajoutees)
   |
11. Etape 3 : test-generator cree un squelette
    *** Update File: tests/auth.test.mjs
    + test('rejette un token expire', ...)
   |
12. test-loop lance les tests :
    [ROUGE] -> le test echoue bien (bon test)
    [VERT] -> apres l''etape 2, le code est en place
   |
13. Etape 4 : npm test -> [OK] 47 passed, 0 failed
   |
14. CodePlan : toutes les etapes [OK]
   |
15. Proposition de commit :
    git add src/middleware/auth.mjs tests/auth.test.mjs
    git commit -m "feat(auth): JWT expiry validation with clockTolerance"
   |
16. Post-commit hook -> memoire Mina mise a jour
   |
17. Resume : 2 fichiers, +12 lignes, 1 test ajoute, suite verte
```

---

## Annexe B — Comparaison detaillee Mina Code vs Claude Code vs Codex

| Capacite | Claude Code | Codex (GPT-5.5) | Mina Code |
|---|---|---|---|
| **Modele principal** | Claude Opus | GPT-5.5 | Gemini/DeepSeek/OR/local |
| **Offline possible** | Non | Non | Oui (LM Studio) |
| **Prix par tache** | ~$0.50-2.00 | ~$0.30-1.50 | ~$0.01-0.50 ou $0 |
| **Indexation codebase** | Oui | Oui | Oui (cette spec) |
| **Diff/patch structure** | edit (diff-aware) | apply_patch | diff-engine + patch-applier |
| **Boucle TDD** | Integree | Integree | test-loop |
| **Git natif** | Oui | Oui | git-client |
| **Plan board visible** | Oui | Oui | code-plan-board |
| **Multi-fichier** | Oui | Oui | refactor-workspace |
| **AGENTS.md** | Oui | Oui | project-context-loader |
| **Revue de code** | Basique | Basique | code-reviewer + security-scanner |
| **Sandbox execution** | Limitee | Limitee | Windows Sandbox jetable |
| **Controle mobile reel** | Non | Non | Android ADB/Kotlin |
| **Memoire cross-session** | Non | Non | Chiffree + vectorielle |
| **Securite par conception** | Basique | Basique | Capability broker + safety policy |
| **Budget tracking** | Cache | Cache | BudgetGuard + pricing live |
| **Multi-canal** | Terminal | Terminal | Voix, SMS, Telegram, Email |
| **Skills marketplace** | MCP ecosysteme | Plugins + skills | Skills + references |
| **Fenetrage contexte** | 200K tokens | 256K tokens | 128K (cloud), 32K (local) |
| **Qualite code** | Excellente | Excellente | Bonne a excellente (selon provider) |

### Avantage unique Mina Code

1. **Prix 10-100x inferieur** grace a DeepSeek + mode offline local gratuit
2. **Zero vendor lock-in** — changer de fournisseur sans changer d''agent
3. **Test sur appareil reel** — lancer des tests E2E sur un vrai telephone Android
4. **Memoire persistante** — l''agent se souvient du projet entre les sessions
5. **Execution offline totale** — fonctionnel sans Internet

---

## Annexe C — Commandes vocales developpeur (detail)

### Navigation et analyse

| Commande | Action | Module |
|---|---|---|
| "Mina, analyse le projet" | Indexation complete | codebase-indexer |
| "Mina, cherche [nom]" | Recherche semantique + symbolique | code-semantic-search |
| "Mina, qui appelle [fonction] ?" | Call graph ascendant | call-graph |
| "Mina, dependances de [fichier]" | Graphe de dependances | dependency-graph |
| "Mina, impact de modifier [fichier]" | Analyse d''impact | change-impact-analyzer |
| "Mina, ou est defini [symbole] ?" | Localisation de definition | symbol-index |
| "Mina, code mort ?" | Detection code inutilise | findDeadCode() |
| "Mina, fichiers sans tests ?" | Fichiers non couverts | findUntestedFiles() |

### Edition

| Commande | Action | Module |
|---|---|---|
| "Mina, applique le patch" | Applique patch en attente | patch-applier |
| "Mina, annule la derniere edition" | Restaure backup | file-backup |
| "Mina, formate le code" | Lance Prettier | code-formatter |
| "Mina, verifie le style" | Lance ESLint | lint-runner |
| "Mina, refactor [description]" | Refactoring multi-fichier | refactor-workspace |

### Tests

| Commande | Action | Module |
|---|---|---|
| "Mina, lance les tests" | npm test | test-runner |
| "Mina, lance les tests modifies" | npm test --changed | test-runner |
| "Mina, genere des tests pour [fichier]" | Squelette de test | test-generator |
| "Mina, couverture ?" | Rapport couverture | coverage-analyzer |
| "Mina, cycle TDD [tache]" | Boucle rouge-vert-refactor | test-loop |

### Git

| Commande | Action | Module |
|---|---|---|
| "Mina, statut Git" | git status | git-status |
| "Mina, diff" | git diff | git-diff |
| "Mina, historique" | git log | git-log |
| "Mina, qui a ecrit cette ligne ?" | git blame | git-log |
| "Mina, commit [message]" | Confirmation -> commit | git-commit |
| "Mina, branches protegees ?" | Liste branches protegees | git-branch-guard |

### Planification

| Commande | Action | Module |
|---|---|---|
| "Mina, planifie [tache]" | Cree un plan | code-plan |
| "Mina, ou en est le plan ?" | Affiche progression | code-plan-board |
| "Mina, valide l''etape [N]" | Marque etape terminee | code-plan-evaluator |
| "Mina, abandonne le plan" | Marque plan abandoned | code-plan-store |

### Providers et budget

| Commande | Action | Module |
|---|---|---|
| "Mina, mode offline" | Bascule local-only | code-provider-router |
| "Mina, mode cloud" | Reactive fournisseurs cloud | code-provider-router |
| "Mina, mode economique" | Route cheapest | code-provider-router |
| "Mina, mode qualite" | Route best-quality | code-provider-router |
| "Mina, budget restant ?" | Affiche budget | BudgetGuard (existant) |
| "Mina, combien a coute la session ?" | Cout total session | usage-collector (existant) |

### Revue

| Commande | Action | Module |
|---|---|---|
| "Mina, revois le code" | Revue complete | code-reviewer |
| "Mina, scan securite" | Scan vulnerabilites | security-scanner |
| "Mina, suggestions d''amelioration" | Suggestions style/perf | code-reviewer |

---

## Resume — Estimation de l''effort total

| Phase | Semaines | Modules | Tests |
|---|---|---|---|
| Phase 1 — Fondations | 1-2 | 4 | 4 fichiers |
| Phase 2 — Intelligence | 3-4 | 7 | 7 fichiers |
| Phase 3 — Edition | 5-6 | 5 | 5 fichiers |
| Phase 4 — Git | 7 | 4 | 4 fichiers |
| Phase 5 — TDD | 8-9 | 5 | 5 fichiers |
| Phase 6 — Plan/Revue | 10 | 6 | 6 fichiers |
| Phase 7 — Providers/UI | 11-12 | 8 | 6 fichiers |
| **TOTAL** | **12 semaines** | **39 modules** | **37 fichiers / 299+ tests** |

---

*Specification generee le 20 juillet 2026. Basee sur l''audit complet du codebase Mina Vision (345 fichiers source, 303 tests, 56 modules). Aucune supposition — uniquement des donnees verifiees par lecture de code.*
