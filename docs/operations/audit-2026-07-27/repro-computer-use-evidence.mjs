import assert from 'node:assert/strict';
import { createLocalComputerUseProvider } from '../../../src/providers/local-computer-use.mjs';
import { createOpenAiCompatibleComputerUseProvider } from '../../../src/providers/openai-compatible-computer-use.mjs';

const marker = 'AUDIT_EVIDENCE_MARKER_20260727';
const evidence = [{ sourceId: 'audit-evidence', extract: marker }];
const observation = {
  width: 1,
  height: 1,
  imageBase64: 'AA==',
  mimeType: 'image/png',
  url: 'https://audit.invalid/',
};
const action = {
  completed: false,
  text: 'action',
  action: {
    name: 'take_screenshot',
    arguments_json: JSON.stringify({
      intent: 'observer',
      safety_decision: 'allowed',
      expected_effect: 'ui_state_change',
    }),
  },
};
const completed = { completed: true, text: 'termine', action: null };

const openAiInputs = [];
const openAiResponses = [action, completed];
const openAiClient = {
  chat: {
    completions: {
      async create(request) {
        const userText = request.messages.find(({ role }) => role === 'user')?.content?.[0]?.text ?? '{}';
        openAiInputs.push(JSON.parse(userText));
        return {
          choices: [{ message: { content: JSON.stringify(openAiResponses.shift()) } }],
        };
      },
    },
  },
};
const openAi = createOpenAiCompatibleComputerUseProvider({
  id: 'audit-openai-compatible',
  model: 'audit-model',
  client: openAiClient,
  includeImage: false,
  idFactory: () => 'audit-openai-interaction',
});
const openAiStart = await openAi.start({
  goal: 'objectif',
  evidence,
  environment: 'browser',
  observation,
});
await openAi.continue({
  interactionId: openAiStart.interactionId,
  call: openAiStart.calls[0],
  actionResult: { executed: true },
  environment: 'browser',
  observation,
});

const localInputs = [];
const localResponses = [
  JSON.stringify({
    completed: false,
    text: 'action',
    action: {
      name: 'take_screenshot',
      arguments: { expected_effect: { type: 'ui_state_change' } },
    },
  }),
  JSON.stringify({ completed: true, text: 'termine' }),
];
const local = createLocalComputerUseProvider({
  modelRegistry: { resolve: () => ({ id: 'audit-local-model' }) },
  modelLoader: {
    load: async () => ({
      plan: async (input) => {
        localInputs.push(input);
        return localResponses.shift();
      },
    }),
  },
  idFactory: () => 'audit-local-interaction',
});
const localStart = await local.start({
  goal: 'objectif',
  evidence,
  environment: 'browser',
  observation,
});
await local.continue({
  interactionId: localStart.interactionId,
  call: localStart.calls[0],
  actionResult: { executed: true },
  environment: 'browser',
  observation,
});

function summary(input) {
  return {
    keys: Object.keys(input),
    markerPresent: JSON.stringify(input).includes(marker),
  };
}

const result = {
  openai: {
    start: summary(openAiInputs[0]),
    continue: summary(openAiInputs[1]),
  },
  local: {
    start: summary(localInputs[0]),
    continue: summary(localInputs[1]),
  },
};
assert.equal(result.openai.start.markerPresent, false);
assert.equal(result.openai.continue.markerPresent, false);
assert.equal(result.local.start.markerPresent, true);
assert.equal(result.local.continue.markerPresent, false);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
