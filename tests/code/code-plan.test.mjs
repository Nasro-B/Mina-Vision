import { describe, expect, it } from 'vitest';
import {
  abortPlan,
  approvePlan,
  completeStep,
  createCodePlan,
  failStep,
  nextStep,
  planProgress,
  skipStep,
  startStep,
} from '../../src/code/planning/code-plan.mjs';
import { createCodePlanStore } from '../../src/code/planning/code-plan-store.mjs';
import { createCodePlanEvaluator } from '../../src/code/planning/code-plan-evaluator.mjs';

const clock = () => '2026-07-20T12:00:00.000Z';

function buildPlan() {
  return createCodePlan({
    id: 'jwt-1',
    title: 'Renouvellement JWT',
    steps: [
      { id: 'test', description: 'Écrire le test rouge', verification: 'tests' },
      { id: 'code', description: 'Code minimal', dependsOn: ['test'], verification: 'tests' },
      { id: 'docs', description: 'Documenter', dependsOn: ['code'], verification: 'file:README.md' },
    ],
    now: clock,
  });
}

describe('code-plan — modèle et transitions', () => {
  it('valide id, titre, étapes, ids uniques et dépendances connues', () => {
    expect(() => createCodePlan({})).toThrow(/id_required/u);
    expect(() => createCodePlan({ id: 'x' })).toThrow(/title_required/u);
    expect(() => createCodePlan({ id: 'x', title: 'T', steps: [] })).toThrow(/steps_required/u);
    expect(() => createCodePlan({ id: 'x', title: 'T', steps: [{ id: 'a', description: 'a' }, { id: 'a', description: 'b' }] }))
      .toThrow(/ids_duplicated/u);
    expect(() => createCodePlan({ id: 'x', title: 'T', steps: [{ description: 'a', dependsOn: ['fantôme'] }] }))
      .toThrow(/dependency_unknown/u);
  });

  it('accepte les étapes en chaînes simples avec ids auto', () => {
    const plan = createCodePlan({ id: 'p', title: 'T', steps: ['une', 'deux'], now: clock });
    expect(plan.steps.map((step) => step.id)).toEqual(['etape-1', 'etape-2']);
    expect(plan.status).toBe('draft');
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.steps[0])).toBe(true);
  });

  it('draft → approved → in_progress, jamais de saut de statut', () => {
    const plan = buildPlan();
    expect(() => startStep(plan, 'test', { now: clock })).toThrow(/transition_invalid/u);
    const approved = approvePlan(plan, { now: clock });
    expect(approved.status).toBe('approved');
    expect(() => approvePlan(approved, { now: clock })).toThrow(/transition_invalid/u);
    const started = startStep(approved, 'test', { now: clock });
    expect(started.status).toBe('in_progress');
    expect(started.steps[0].status).toBe('in_progress');
  });

  it('une étape ne démarre pas si ses dépendances ne sont pas terminées', () => {
    const approved = approvePlan(buildPlan(), { now: clock });
    expect(() => startStep(approved, 'code', { now: clock })).toThrow(/dependency_incomplete/u);
  });

  it('cycle complet : toutes les étapes terminées → plan completed avec completedAt', () => {
    let plan = approvePlan(buildPlan(), { now: clock });
    plan = startStep(plan, 'test', { now: clock });
    plan = completeStep(plan, 'test', { success: true }, { now: clock });
    plan = startStep(plan, 'code', { now: clock });
    plan = completeStep(plan, 'code', { success: true, testsPassed: 42 }, { now: clock });
    plan = startStep(plan, 'docs', { now: clock });
    plan = completeStep(plan, 'docs', null, { now: clock });
    expect(plan.status).toBe('completed');
    expect(plan.completedAt).toBe(clock());
    expect(plan.steps.every((step) => step.status === 'completed')).toBe(true);
  });

  it('skip compte comme terminé pour les dépendances et la complétion', () => {
    let plan = approvePlan(buildPlan(), { now: clock });
    plan = skipStep(plan, 'test', 'déjà couvert', { now: clock });
    plan = startStep(plan, 'code', { now: clock });
    plan = completeStep(plan, 'code', null, { now: clock });
    plan = skipStep(plan, 'docs', null, { now: clock });
    expect(plan.status).toBe('completed');
    expect(plan.steps[0].result).toEqual({ reason: 'déjà couvert' });
  });

  it('failStep garde le plan en cours, abortPlan est terminal', () => {
    let plan = approvePlan(buildPlan(), { now: clock });
    plan = startStep(plan, 'test', { now: clock });
    plan = failStep(plan, 'test', { error: 'rouge' }, { now: clock });
    expect(plan.status).toBe('in_progress');
    expect(plan.steps[0].status).toBe('failed');
    const aborted = abortPlan(plan, 'Nasro a annulé', { now: clock });
    expect(aborted.status).toBe('aborted');
    expect(() => abortPlan(aborted, 'x', { now: clock })).toThrow(/transition_invalid/u);
  });

  it('planProgress et nextStep reflètent l\'état réel', () => {
    let plan = approvePlan(buildPlan(), { now: clock });
    expect(nextStep(plan).id).toBe('test');
    plan = startStep(plan, 'test', { now: clock });
    plan = completeStep(plan, 'test', null, { now: clock });
    const progress = planProgress(plan);
    expect(progress).toMatchObject({ total: 3, done: 1, percent: 33 });
    expect(nextStep(plan).id).toBe('code');
  });
});

function createMemFs(initial = {}) {
  const files = new Map(Object.entries(initial));
  return {
    files,
    readFile: async (path) => {
      if (!files.has(path)) throw new Error(`ENOENT: ${path}`);
      return files.get(path);
    },
    writeFile: async (path, content) => { files.set(path, content); },
    readdir: async () => [...files.keys()].map((path) => path.split('/').pop()),
    mkdir: async () => {},
    rm: async (path) => { files.delete(path); },
  };
}

describe('code-plan-store', () => {
  it('exige fs et dossier, valide les ids', async () => {
    expect(() => createCodePlanStore({})).toThrow(/fs_required/u);
    const store = createCodePlanStore({ fs: createMemFs(), directory: 'C:/plans' });
    await expect(store.get('../évasion')).rejects.toThrow(/id_invalid/u);
    await expect(store.save({ id: 'a b' })).rejects.toThrow(/id_invalid/u);
  });

  it('save → get → list rond-trip avec tri par date décroissante', async () => {
    const store = createCodePlanStore({ fs: createMemFs(), directory: 'C:/plans' });
    await store.save({ id: 'ancien', title: 'A', status: 'completed', updatedAt: '2026-07-19' });
    await store.save({ id: 'recent', title: 'R', status: 'draft', updatedAt: '2026-07-20' });
    expect((await store.get('ancien')).title).toBe('A');
    expect(await store.get('inconnu')).toBeNull();
    const list = await store.list();
    expect(list.map((entry) => entry.id)).toEqual(['recent', 'ancien']);
  });

  it('archive déplace le plan et le retire de la liste', async () => {
    const memFs = createMemFs();
    const store = createCodePlanStore({ fs: memFs, directory: 'C:/plans' });
    await store.save({ id: 'p1', title: 'P', status: 'completed', updatedAt: 'x' });
    const archived = await store.archive('p1');
    expect(archived.id).toBe('p1');
    expect(await store.get('p1')).toBeNull();
    expect(memFs.files.has('C:/plans/archive-plan-p1.json')).toBe(true);
    await expect(store.archive('p1')).rejects.toThrow(/store_unknown/u);
  });

  it('fichier corrompu ignoré par list, sans exception', async () => {
    const memFs = createMemFs({ 'C:/plans/plan-cassé.json': '{invalid' });
    const store = createCodePlanStore({ fs: memFs, directory: 'C:/plans' });
    await store.save({ id: 'sain', title: 'S', status: 'draft', updatedAt: 'x' });
    const list = await store.list();
    expect(list.map((entry) => entry.id)).toEqual(['sain']);
  });
});

describe('code-plan-evaluator', () => {
  it('vérification vide → jamais auto-validée (validation manuelle)', async () => {
    const evaluator = createCodePlanEvaluator({});
    const result = await evaluator.evaluateStep({ verification: '' });
    expect(result.satisfied).toBe(false);
    expect(result.evidence).toContain('manuelle');
  });

  it('« tests » : vert → satisfait avec preuve chiffrée, rouge → refusé', async () => {
    const green = createCodePlanEvaluator({ testRunner: { runAll: async () => ({ passed: 42, failed: 0, parsed: true }) } });
    const ok = await green.evaluateStep({ verification: 'tests' });
    expect(ok.satisfied).toBe(true);
    expect(ok.evidence).toContain('42 verts');

    const red = createCodePlanEvaluator({ testRunner: { runAll: async () => ({ passed: 40, failed: 2, parsed: true }) } });
    expect((await red.evaluateStep({ verification: 'tests' })).satisfied).toBe(false);
  });

  it('« file: » et « pattern: » vérifient le disque réel injecté', async () => {
    const memFs = createMemFs({ 'README.md': '# Documentation JWT complète' });
    const evaluator = createCodePlanEvaluator({ fs: memFs });
    expect((await evaluator.evaluateStep({ verification: 'file:README.md' })).satisfied).toBe(true);
    expect((await evaluator.evaluateStep({ verification: 'file:ABSENT.md' })).satisfied).toBe(false);
    const patternOk = await evaluator.evaluateStep({ verification: 'pattern:JWT complète:README.md' });
    expect(patternOk.satisfied).toBe(true);
    expect(patternOk.evidence).toContain('JWT complète');
    expect((await evaluator.evaluateStep({ verification: 'pattern:inexistant:README.md' })).satisfied).toBe(false);
  });

  it('format inconnu ou regex invalide → refusé avec raison nominée', async () => {
    const evaluator = createCodePlanEvaluator({ fs: createMemFs({ 'a.md': 'x' }) });
    expect((await evaluator.evaluateStep({ verification: 'magie:zzz' })).evidence).toMatch(/verification_unknown/u);
    expect((await evaluator.evaluateStep({ verification: 'pattern:([:a.md' })).evidence).toMatch(/pattern_invalid/u);
  });

  it('evaluatePlan ne rejuge que les étapes completed et agrège allSatisfied', async () => {
    const memFs = createMemFs({ 'README.md': 'ok' });
    const evaluator = createCodePlanEvaluator({ fs: memFs });
    const plan = {
      steps: [
        { id: 'a', status: 'completed', verification: 'file:README.md' },
        { id: 'b', status: 'pending', verification: 'file:ABSENT.md' },
        { id: 'c', status: 'completed', verification: 'file:ABSENT.md' },
      ],
    };
    const result = await evaluator.evaluatePlan(plan);
    expect(result.evaluations.map((entry) => entry.stepId)).toEqual(['a', 'c']);
    expect(result.allSatisfied).toBe(false);
  });
});
