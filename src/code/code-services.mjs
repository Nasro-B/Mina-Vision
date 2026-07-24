// Composition root du domaine Mina Code : construit TOUS les services réels liés à une racine
// de projet (fs réel, git réel via execFile, vitest réel). C'est le seul endroit où les
// dépendances concrètes sont assemblées — partout ailleurs, elles restent injectées.

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createCommandRunner } from './run-command.mjs';
import { createAstParser } from './intelligence/ast-parser.mjs';
import { createSymbolIndex } from './intelligence/symbol-index.mjs';
import { createCallGraph } from './intelligence/call-graph.mjs';
import { createDependencyGraph } from './intelligence/dependency-graph.mjs';
import { createCodebaseIndexer } from './intelligence/codebase-indexer.mjs';
import { createCodeSemanticSearch } from './intelligence/code-semantic-search.mjs';
import { createChangeImpactAnalyzer } from './intelligence/change-impact-analyzer.mjs';
import { createProjectContextLoader } from './intelligence/project-context-loader.mjs';
import { createGitignoreMatcher } from './intelligence/gitignore-matcher.mjs';
import { createFileBackup } from './editing/file-backup.mjs';
import { createDiffEngine } from './editing/diff-engine.mjs';
import { createPatchApplier } from './editing/patch-applier.mjs';
import { createGitClient } from './git/git-client.mjs';
import { createGitStatus } from './git/git-status.mjs';
import { createGitDiff } from './git/git-diff.mjs';
import { createGitLog } from './git/git-log.mjs';
import { createGitCommit } from './git/git-commit.mjs';
import { createGitBranchGuard } from './git/git-branch-guard.mjs';
import { createGitPostCommitHook } from './git/git-hook-post-commit.mjs';
import { createTestRunner } from './testing/test-runner.mjs';
import { createSecurityScanner } from './review/security-scanner.mjs';
import { createStyleChecker } from './review/style-checker.mjs';
import { createCodeReviewer } from './review/code-reviewer.mjs';
import { createCodePlanStore } from './planning/code-plan-store.mjs';
import { createCodeVerifier } from './code-verifier.mjs';

const toAbsolute = (projectRoot, relative) => `${String(projectRoot).replace(/[\\/]+$/u, '')}/${relative}`;

export function createCodeServices({
  projectRoot,
  plansDirectory,
  activityJournal = null,
  memoryService = null,
  confirm = async () => false,
} = {}) {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) {
    throw new TypeError('code_services_project_root_required');
  }
  if (typeof plansDirectory !== 'string' || plansDirectory.length === 0) {
    throw new TypeError('code_services_plans_directory_required');
  }

  const nodeFs = { readFile, writeFile, readdir, rm, mkdir };
  // Les chemins relatifs du domaine code sont résolus contre la racine du projet analysé.
  const projectFs = Object.freeze({
    readFile: (path, encoding) => readFile(/^[a-z]:[\\/]/iu.test(path) ? path : toAbsolute(projectRoot, path), encoding),
    writeFile: (path, content, encoding) => writeFile(/^[a-z]:[\\/]/iu.test(path) ? path : toAbsolute(projectRoot, path), content, encoding),
    rm: (path, options) => rm(/^[a-z]:[\\/]/iu.test(path) ? path : toAbsolute(projectRoot, path), options),
    readdir: (path, options) => readdir(path, options),
  });

  const runCommand = createCommandRunner();
  const astParser = createAstParser();
  const symbolIndex = createSymbolIndex();
  const callGraph = createCallGraph();
  const dependencyGraph = createDependencyGraph();
  // `.gitignore` du projet analysé → Mina Code n'indexe/ne revoit PAS ce que le dépôt ignore
  // (prototypes morts, env/, sorties de build). Absent ou illisible : on n'ignore rien, comme
  // avant. Lu une fois à la construction, best-effort.
  let ignore = null;
  try {
    ignore = createGitignoreMatcher(readFileSync(toAbsolute(projectRoot, '.gitignore'), 'utf8'));
  } catch { /* pas de .gitignore : indexation complète, comportement historique */ }
  const indexer = createCodebaseIndexer({
    astParser,
    callGraph,
    dependencyGraph,
    symbolIndex,
    fileReader: { readFile, readdir },
    projectRoot,
    ignore,
  });
  const fileContent = (path) => indexer.fileContent(path);
  const search = createCodeSemanticSearch({ symbolIndex, callGraph, fileContent });
  const impactAnalyzer = createChangeImpactAnalyzer({ dependencyGraph, callGraph, symbolIndex });
  const contextLoader = createProjectContextLoader({ fileReader: { readFile, readdir } });
  let contextCache = null;
  const projectContext = () => {
    contextCache ??= contextLoader.load(projectRoot);
    return contextCache;
  };

  const fileBackup = createFileBackup({ fs: projectFs });
  const diffEngine = createDiffEngine({ fs: projectFs, fileBackup });
  const patchApplier = createPatchApplier({ diffEngine, fileBackup, astParser, fs: projectFs });

  const gitClient = createGitClient({ runCommand, repoPath: projectRoot, confirm });
  const gitStatus = createGitStatus({ gitClient });
  const gitDiff = createGitDiff({ gitClient });
  const gitLog = createGitLog({ gitClient });
  const postCommitHook = createGitPostCommitHook({ memoryService, activityJournal });

  const securityScanner = createSecurityScanner({ fileContent });
  const styleChecker = createStyleChecker({ fileContent, astParser });
  const reviewer = createCodeReviewer({ astParser, securityScanner, styleChecker, fileContent });
  const verifier = createCodeVerifier({ astParser, securityScanner, diffEngine, fs: projectFs });
  const planStore = createCodePlanStore({ fs: nodeFs, directory: plansDirectory });

  const services = {
    projectRoot,
    runCommand,
    astParser,
    symbolIndex,
    callGraph,
    dependencyGraph,
    indexer,
    search,
    impactAnalyzer,
    contextLoader,
    projectContext,
    fileBackup,
    diffEngine,
    patchApplier,
    gitClient,
    gitStatus,
    gitDiff,
    gitLog,
    postCommitHook,
    securityScanner,
    styleChecker,
    reviewer,
    verifier,
    planStore,
  };

  // Le test runner et la garde de branches ont besoin du contexte projet (chargé une fois).
  services.buildContextBound = async () => {
    const context = await projectContext();
    const branchGuard = createGitBranchGuard({ projectContext: context });
    const gitCommit = createGitCommit({ gitClient, branchGuard, postCommitHook });
    const testRunner = createTestRunner({ runCommand, projectRoot, projectContext: context });
    return Object.freeze({ branchGuard, gitCommit, testRunner });
  };
  // Accès direct pratique (construits à la première demande).
  let boundCache = null;
  const bound = () => {
    boundCache ??= services.buildContextBound();
    return boundCache;
  };
  services.testRunner = Object.freeze({
    detectFramework: async () => (await bound()).testRunner.detectFramework(),
    runAll: async (options) => (await bound()).testRunner.runAll(options),
    runFile: async (file, options) => (await bound()).testRunner.runFile(file, options),
    runChanged: async (options) => (await bound()).testRunner.runChanged(options),
  });
  services.gitCommit = Object.freeze({
    commit: async (request) => (await bound()).gitCommit.commit(request),
  });
  services.branchGuard = Object.freeze({
    listProtected: async () => (await bound()).branchGuard.listProtected(),
  });

  return Object.freeze(services);
}
