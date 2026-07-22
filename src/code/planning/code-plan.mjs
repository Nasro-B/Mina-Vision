// Modèle de plan de code : transitions pures et gelées (même style que mission-state.mjs).
// draft → approved → in_progress → completed | aborted. Une étape ne démarre que si toutes
// ses dépendances sont terminées.

const PLAN_STATUSES = new Set(['draft', 'approved', 'in_progress', 'completed', 'aborted']);
const STEP_STATUSES = new Set(['pending', 'in_progress', 'completed', 'failed', 'skipped']);

const freezePlan = (plan) => Object.freeze({
  ...plan,
  steps: Object.freeze(plan.steps.map((step) => Object.freeze({ ...step, dependsOn: Object.freeze([...step.dependsOn]), files: Object.freeze([...step.files]) }))),
});

export function createCodePlan({ id, title, steps = [], now = () => new Date().toISOString() } = {}) {
  if (typeof id !== 'string' || id.length === 0) throw new Error('code_plan_id_required');
  if (typeof title !== 'string' || title.length === 0) throw new Error('code_plan_title_required');
  if (!Array.isArray(steps) || steps.length === 0) throw new Error('code_plan_steps_required');
  const timestamp = now();
  const normalizedSteps = steps.map((step, index) => {
    const description = typeof step === 'string' ? step : step?.description;
    if (typeof description !== 'string' || description.length === 0) {
      throw new Error(`code_plan_step_invalid: étape ${index + 1}`);
    }
    return {
      id: step?.id ?? `etape-${index + 1}`,
      description,
      status: 'pending',
      dependsOn: Array.isArray(step?.dependsOn) ? [...step.dependsOn] : [],
      verification: typeof step?.verification === 'string' ? step.verification : '',
      files: Array.isArray(step?.files) ? [...step.files] : [],
      result: null,
    };
  });
  const ids = new Set(normalizedSteps.map((step) => step.id));
  if (ids.size !== normalizedSteps.length) throw new Error('code_plan_step_ids_duplicated');
  for (const step of normalizedSteps) {
    for (const dependency of step.dependsOn) {
      if (!ids.has(dependency)) throw new Error(`code_plan_dependency_unknown: ${dependency}`);
    }
  }
  return freezePlan({
    id,
    title,
    status: 'draft',
    steps: normalizedSteps,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: null,
  });
}

const withUpdate = (plan, changes, now) => freezePlan({ ...plan, ...changes, updatedAt: now() });

export function approvePlan(plan, { now = () => new Date().toISOString() } = {}) {
  if (plan.status !== 'draft') throw new Error(`code_plan_transition_invalid: ${plan.status} → approved`);
  return withUpdate(plan, { status: 'approved' }, now);
}

function updateStep(plan, stepId, updater, now) {
  const index = plan.steps.findIndex((step) => step.id === stepId);
  if (index === -1) throw new Error(`code_plan_step_unknown: ${stepId}`);
  const steps = plan.steps.map((step, position) => (position === index ? updater({ ...step }) : { ...step, dependsOn: [...step.dependsOn], files: [...step.files] }));
  return freezePlan({ ...plan, steps, updatedAt: now() });
}

export function startStep(plan, stepId, { now = () => new Date().toISOString() } = {}) {
  if (!['approved', 'in_progress'].includes(plan.status)) {
    throw new Error(`code_plan_transition_invalid: démarrer une étape sur un plan ${plan.status}`);
  }
  const target = plan.steps.find((step) => step.id === stepId);
  if (!target) throw new Error(`code_plan_step_unknown: ${stepId}`);
  if (target.status !== 'pending') throw new Error(`code_plan_step_transition_invalid: ${target.status} → in_progress`);
  for (const dependency of target.dependsOn) {
    const upstream = plan.steps.find((step) => step.id === dependency);
    if (upstream.status !== 'completed' && upstream.status !== 'skipped') {
      throw new Error(`code_plan_dependency_incomplete: ${dependency}`);
    }
  }
  const next = updateStep(plan, stepId, (step) => ({ ...step, status: 'in_progress' }), now);
  return plan.status === 'approved' ? withUpdate(next, { status: 'in_progress' }, now) : next;
}

function finishStep(plan, stepId, status, result, now) {
  const target = plan.steps.find((step) => step.id === stepId);
  if (!target) throw new Error(`code_plan_step_unknown: ${stepId}`);
  if (target.status !== 'in_progress' && !(status === 'skipped' && target.status === 'pending')) {
    throw new Error(`code_plan_step_transition_invalid: ${target.status} → ${status}`);
  }
  let next = updateStep(plan, stepId, (step) => ({ ...step, status, result: result ?? null }), now);
  const allDone = next.steps.every((step) => ['completed', 'skipped'].includes(step.status));
  if (allDone) {
    next = withUpdate(next, { status: 'completed', completedAt: now() }, now);
  }
  return next;
}

export function completeStep(plan, stepId, result, { now = () => new Date().toISOString() } = {}) {
  return finishStep(plan, stepId, 'completed', result, now);
}

export function failStep(plan, stepId, result, { now = () => new Date().toISOString() } = {}) {
  return finishStep(plan, stepId, 'failed', result, now);
}

export function skipStep(plan, stepId, reason, { now = () => new Date().toISOString() } = {}) {
  return finishStep(plan, stepId, 'skipped', reason ? { reason } : null, now);
}

export function abortPlan(plan, reason, { now = () => new Date().toISOString() } = {}) {
  if (['completed', 'aborted'].includes(plan.status)) {
    throw new Error(`code_plan_transition_invalid: ${plan.status} → aborted`);
  }
  return withUpdate(plan, { status: 'aborted', abortReason: reason ?? null }, now);
}

export function planProgress(plan) {
  const done = plan.steps.filter((step) => ['completed', 'skipped'].includes(step.status)).length;
  return Object.freeze({
    total: plan.steps.length,
    done,
    failed: plan.steps.filter((step) => step.status === 'failed').length,
    inProgress: plan.steps.find((step) => step.status === 'in_progress')?.id ?? null,
    percent: Math.round((done / plan.steps.length) * 100),
  });
}

export function nextStep(plan) {
  return plan.steps.find((step) => (
    step.status === 'pending'
    && step.dependsOn.every((dependency) => ['completed', 'skipped'].includes(plan.steps.find((entry) => entry.id === dependency)?.status))
  )) ?? null;
}

export const isValidPlanStatus = (status) => PLAN_STATUSES.has(status);
export const isValidStepStatus = (status) => STEP_STATUSES.has(status);
