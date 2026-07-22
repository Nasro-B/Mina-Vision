import { randomUUID } from 'node:crypto';
import { normalizeAction } from '../executors/action-normalizer.mjs';

const ENVIRONMENTS = new Set(['browser', 'desktop', 'mobile']);
const EFFECTS = new Set(['ui_state_change', 'file_appeared', 'print_job_accepted', 'message_accepted']);

function outputText(raw) {
  if (typeof raw === 'string') return raw;
  if (typeof raw?.generated_text === 'string') return raw.generated_text;
  if (typeof raw?.output === 'string') return raw.output;
  if (Array.isArray(raw) && typeof raw[0]?.generated_text === 'string') return raw[0].generated_text;
  throw new Error('local_computer_use_output_invalid');
}

function expectedEffect(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !EFFECTS.has(value.type)) {
    throw new Error('expected_effect_required');
  }
  return value;
}

function parsePlan(raw, { interactionId, callIndex, observation, modelId, maxOutputChars }) {
  const text = outputText(raw).trim();
  if (text.length > maxOutputChars) throw new Error('local_computer_use_output_too_large');
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('local_computer_use_json_required');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.completed !== 'boolean') {
    throw new Error('local_computer_use_schema_invalid');
  }
  const responseText = typeof value.text === 'string' ? value.text.slice(0, 4_000) : '';
  if (value.completed) {
    if (value.action !== undefined) throw new Error('local_computer_use_schema_invalid');
    return Object.freeze({ interactionId, completed: true, text: responseText, calls: Object.freeze([]), modelId });
  }
  if (!value.action || typeof value.action.name !== 'string'
    || !value.action.arguments || typeof value.action.arguments !== 'object' || Array.isArray(value.action.arguments)) {
    throw new Error('local_computer_use_schema_invalid');
  }
  const effect = expectedEffect(value.expectedEffect ?? value.action.arguments.expected_effect);
  const call = Object.freeze({
    id: `${interactionId}:call:${callIndex}`,
    name: value.action.name,
    arguments: Object.freeze({ ...value.action.arguments, expected_effect: effect }),
  });
  normalizeAction(call, observation);
  return Object.freeze({
    interactionId,
    completed: false,
    text: responseText,
    calls: Object.freeze([call]),
    modelId,
  });
}

function boundedObservation(observation) {
  if (!Number.isFinite(observation?.width) || !Number.isFinite(observation?.height)
    || observation.width < 1 || observation.height < 1
    || typeof observation.imageBase64 !== 'string' || observation.imageBase64.length > 35 * 1024 * 1024
    || !/^image\/(?:png|jpeg|webp)$/u.test(observation.mimeType ?? '')) {
    throw new TypeError('local_computer_use_observation_invalid');
  }
  return Object.freeze({
    imageBase64: observation.imageBase64,
    mimeType: observation.mimeType,
    width: observation.width,
    height: observation.height,
    url: typeof observation.url === 'string' ? observation.url.slice(0, 4_000) : null,
    ...(observation.web ? { web: observation.web } : {}),
  });
}

export function createLocalComputerUseProvider({
  modelRegistry,
  modelLoader,
  idFactory = randomUUID,
  maxOutputChars = 16_000,
  maxTurns = 80,
} = {}) {
  if (!modelRegistry?.resolve || !modelLoader?.load) throw new TypeError('local_computer_use_dependencies_required');
  const sessions = new Map();

  async function runPlanner(input) {
    const pipeline = await modelLoader.load('computer-use');
    const plan = pipeline.plan ?? pipeline.run;
    if (typeof plan !== 'function') throw new Error('local_computer_use_pipeline_invalid');
    return plan(input);
  }

  async function start({ goal, evidence = [], environment, observation } = {}) {
    if (typeof goal !== 'string' || !goal.trim() || goal.length > 20_000 || !ENVIRONMENTS.has(environment)) {
      throw new TypeError('local_computer_use_request_invalid');
    }
    const safeObservation = boundedObservation(observation);
    const model = modelRegistry.resolve('computer-use', { localOnly: true });
    const interactionId = String(idFactory());
    const session = {
      goal: goal.trim(),
      environment,
      evidence: Array.isArray(evidence) ? evidence.slice(0, 20) : [],
      turns: 1,
      modelId: model.id,
    };
    try {
      const raw = await runPlanner(Object.freeze({
        phase: 'start',
        goal: session.goal,
        environment,
        observation: safeObservation,
        evidence: session.evidence,
        outputContract: 'strict_json_action_with_expected_effect',
      }));
      const response = parsePlan(raw, {
        interactionId, callIndex: session.turns, observation: safeObservation, modelId: model.id, maxOutputChars,
      });
      if (!response.completed) sessions.set(interactionId, session);
      return response;
    } catch (error) {
      sessions.delete(interactionId);
      throw error;
    }
  }

  async function continueInteraction({ interactionId, call, actionResult, observation, environment } = {}) {
    const session = sessions.get(interactionId);
    if (!session) throw new Error('local_interaction_unknown');
    if (environment !== session.environment) throw new Error('local_interaction_environment_mismatch');
    session.turns += 1;
    if (session.turns > maxTurns) {
      sessions.delete(interactionId);
      throw new Error('local_interaction_turn_limit');
    }
    const safeObservation = boundedObservation(observation);
    const raw = await runPlanner(Object.freeze({
      phase: 'continue',
      goal: session.goal,
      environment,
      previousCall: call,
      actionResult,
      observation: safeObservation,
      outputContract: 'strict_json_action_with_expected_effect',
    }));
    const response = parsePlan(raw, {
      interactionId, callIndex: session.turns, observation: safeObservation,
      modelId: session.modelId, maxOutputChars,
    });
    if (response.completed) sessions.delete(interactionId);
    return response;
  }

  async function invoke(input = {}) {
    if (input.operation === 'start') return start(input);
    if (input.operation === 'continue') return continueInteraction(input);
    throw new Error('local_computer_use_operation_invalid');
  }

  function health() {
    try {
      modelRegistry.resolve('computer-use', { localOnly: true });
      return Object.freeze({ available: true });
    } catch (error) {
      return Object.freeze({ available: false, reason: error.message });
    }
  }

  return Object.freeze({
    id: 'local-computer-use',
    locality: 'local',
    network: 'none',
    capabilities: Object.freeze(['computer.use']),
    health,
    start,
    continue: continueInteraction,
    invoke,
  });
}
