// Test d'intégration RÉEL : les services Mina Code assemblés indexent le vrai dépôt Mina Vision
// (src/ complet, sans node_modules ni symlinks) et répondent sur de vrais symboles du projet.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCodeServices } from '../../src/code/code-services.mjs';

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/[\\/]+$/u, '');

describe('code-services — projet Mina Vision réel', () => {
  let services;
  let plansDirectory;
  let report;

  beforeAll(async () => {
    plansDirectory = await mkdtemp(join(tmpdir(), 'mina-plans-'));
    services = createCodeServices({ projectRoot: PROJECT_ROOT, plansDirectory });
    report = await services.indexer.fullIndex({});
    // 180 s : l'indexation seule prend ~30 s, mais sous la suite COMPLÈTE en parallèle (320
    // fichiers de tests + l'app Electron ouverte) le partage CPU a fait dépasser 60 s (2026-07-22).
  }, 180_000);

  afterAll(async () => {
    await rm(plansDirectory, { recursive: true, force: true }).catch(() => {});
  });

  it('valide ses entrées', () => {
    expect(() => createCodeServices({})).toThrow(/project_root_required/u);
    expect(() => createCodeServices({ projectRoot: 'C:/x' })).toThrow(/plans_directory_required/u);
  });

  it('indexe un volume réaliste de fichiers source réels', () => {
    expect(report.total).toBeGreaterThan(300);
    expect(report.indexed).toBe(report.total);
    const status = services.indexer.status();
    expect(status.symbols).toBeGreaterThan(1_000);
  });

  it('l\'index ne contient JAMAIS node_modules ni .git', () => {
    const files = services.indexer.indexedFiles();
    expect(files.some((file) => file.includes('node_modules'))).toBe(false);
    expect(files.some((file) => file.includes('.git/'))).toBe(false);
  });

  it('retrouve un vrai symbole du projet (createMinaOrchestrator) à son vrai emplacement', () => {
    const results = services.symbolIndex.byName('createMinaOrchestrator', { exact: true });
    expect(results).toHaveLength(1);
    expect(results[0].file).toBe('src/core/orchestrator.mjs');
    expect(results[0].visibility).toBe('exported');
  });

  it('la recherche remonte le module recherché dans le top 5', async () => {
    const hits = await services.search.search('activity journal', { maxResults: 5 });
    expect(hits.some((hit) => hit.file.includes('activity-journal'))).toBe(true);
  });

  it('le graphe de dépendances connaît les liens réels du cœur', () => {
    const dependencies = services.indexer.getDependencies('src/core/orchestrator.mjs');
    expect(dependencies.direct).toContain('src/core/mission-state.mjs');
    expect(dependencies.direct).toContain('src/executors/action-normalizer.mjs');
  });

  it('le contexte projet réel charge MINA.md et détecte Electron', async () => {
    const context = await services.projectContext();
    expect(context.minaMd).toContain('Mina Vision');
    expect(context.framework).toBe('Electron');
    expect(context.frameworks).toContain('Vitest');
    expect(context.scripts.test).toContain('vitest');
  }, 15_000);

  it('le vrai projet est un dépôt git depuis la réconciliation 2026-07-22 (fait vérifié)', async () => {
    expect(await services.gitClient.isRepository()).toBe(true);
    const branch = await services.gitClient.currentBranch();
    expect(typeof branch).toBe('string');
    expect(branch.length).toBeGreaterThan(0);
  });

  it('la revue de vrais fichiers du domaine code ne trouve aucun secret', async () => {
    const files = services.indexer.indexedFiles().filter((file) => file.startsWith('src/code/')).slice(0, 20);
    expect(files.length).toBeGreaterThan(5);
    const reportReview = await services.reviewer.review({ files, focus: 'security' });
    expect(reportReview.findings.filter((finding) => finding.category === 'secret')).toEqual([]);
  }, 15_000);
});
