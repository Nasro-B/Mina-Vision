import { classifyFailure } from '../core/error-resilience.mjs';
import { createCapabilityRouter } from '../routing/capability-router.mjs';
import { createInferenceModePolicy } from '../routing/inference-mode-policy.mjs';
import { createComputerUseClient } from './gemini-computer-use.mjs';
import { createOpenAiCompatibleComputerUseProvider } from './openai-compatible-computer-use.mjs';
import { createProviderRegistry } from './provider-registry.mjs';
import { createRoutedComputerUse } from './routed-computer-use.mjs';

const OPENROUTER_FREE_VISION_MODEL = 'google/gemma-4-26b-a4b-it:free';
const OPENROUTER_FREE_ROUTER_MODEL = 'openrouter/free';
const MODAL_DEFAULT_MODEL = 'Qwen/Qwen3.5-9B';

function geminiProvider({ config, client }) {
  const computerUse = client ?? createComputerUseClient({
    apiKey: config.geminiApiKey,
    model: config.providers?.gemini?.model,
  });
  return Object.freeze({
    id: 'gemini-computer-use',
    locality: 'cloud',
    network: 'internet',
    modelId: config.providers?.gemini?.model ?? 'gemini-3.5-flash',
    capabilities: Object.freeze(['computer.use']),
    health: () => Object.freeze({ available: true }),
    invoke: (input) => {
      if (input.operation === 'start') return computerUse.start(input);
      if (input.operation === 'continue') return computerUse.continue(input);
      throw new Error('computer_use_operation_invalid');
    },
  });
}

function modalBaseUrl(endpoint) {
  const parsed = new URL(endpoint);
  if (parsed.protocol !== 'https:') throw new Error('MODAL_ENDPOINT doit utiliser HTTPS.');
  return `${parsed.href.replace(/\/+$/u, '').replace(/\/v1$/u, '')}/v1`;
}

function shouldRecover(error) {
  if (Number(error?.status) === 401) return true;
  return classifyFailure(error) !== 'safety';
}

export function createComputerUseRuntime({ config, geminiClient, openAiClientFactory, localProvider } = {}) {
  if (!config?.inference) throw new TypeError('computer_use_runtime_config_required');
  const registry = createProviderRegistry();

  if (config.geminiApiKey || geminiClient) registry.register(geminiProvider({ config, client: geminiClient }));

  if (config.modalEndpoint && config.modalTokenId && config.modalTokenSecret) {
    registry.register(createOpenAiCompatibleComputerUseProvider({
      id: 'modal-computer-use',
      apiKey: 'unused',
      baseURL: modalBaseUrl(config.modalEndpoint),
      model: config.providers?.modal?.model ?? MODAL_DEFAULT_MODEL,
      defaultHeaders: {
        'Modal-Key': config.modalTokenId,
        'Modal-Secret': config.modalTokenSecret,
      },
      includeImage: false,
      environments: ['browser'],
      clientFactory: openAiClientFactory,
    }));
  }

  if (config.openrouterApiKey) {
    const primaryModel = config.openrouterVisionModel ?? config.providers?.openrouter?.model ?? OPENROUTER_FREE_VISION_MODEL;
    registry.register(createOpenAiCompatibleComputerUseProvider({
      id: 'openrouter-computer-use',
      apiKey: config.openrouterApiKey,
      baseURL: config.providers?.openrouter?.baseUrl ?? 'https://openrouter.ai/api/v1',
      model: primaryModel,
      clientFactory: openAiClientFactory,
    }));
    if (primaryModel !== OPENROUTER_FREE_ROUTER_MODEL) {
      registry.register(createOpenAiCompatibleComputerUseProvider({
        id: 'openrouter-free-router-computer-use',
        apiKey: config.openrouterApiKey,
        baseURL: config.providers?.openrouter?.baseUrl ?? 'https://openrouter.ai/api/v1',
        model: OPENROUTER_FREE_ROUTER_MODEL,
        clientFactory: openAiClientFactory,
      }));
    }
  }

  if (config.providers?.lmStudio?.enabled && config.providers.lmStudio.model) {
    registry.register(createOpenAiCompatibleComputerUseProvider({
      id: 'lm-studio-computer-use',
      apiKey: 'lm-studio',
      baseURL: config.providers.lmStudio.baseUrl,
      model: config.providers.lmStudio.model,
      locality: 'local',
      network: 'loopback',
      timeoutMs: config.providers.lmStudio.timeoutMs,
      maxOutputTokens: 512,
      clientFactory: openAiClientFactory,
    }));
  }

  if (localProvider) registry.register(localProvider);

  const capabilityRouter = createCapabilityRouter({
    providerRegistry: registry,
    modePolicy: createInferenceModePolicy(),
  });
  const computerUse = createRoutedComputerUse({
    capabilityRouter,
    providerRegistry: registry,
    defaultMode: config.inference.mode,
    defaultOffline: config.inference.offline,
    failurePolicy: {
      recover: ({ error, remainingRoutes }) => {
        if (!shouldRecover(error) || !remainingRoutes[0]) return null;
        return { action: 'new_interaction', providerId: remainingRoutes[0].providerId };
      },
    },
  });

  return Object.freeze({ computerUse, providers: registry.list(), registry, capabilityRouter });
}
