import {
  createGeminiCameraVision,
  createOpenAiCompatibleCameraVision,
  createRoutedCameraVision,
} from './camera-vision.mjs';

const OPENROUTER_FREE_VISION_MODEL = 'google/gemma-4-26b-a4b-it:free';
const OPENROUTER_FREE_ROUTER_MODEL = 'openrouter/free';

export function createCameraVisionRuntime({ config, geminiClient, openAiClientFactory } = {}) {
  if (!config?.inference) throw new TypeError('camera_vision_runtime_config_required');
  const providers = [];

  if (config.geminiApiKey || geminiClient) {
    providers.push(createGeminiCameraVision({ apiKey: config.geminiApiKey, client: geminiClient }));
  }

  if (config.openrouterApiKey) {
    const primaryModel = config.openrouterVisionModel
      ?? config.providers?.openrouter?.model
      ?? OPENROUTER_FREE_VISION_MODEL;
    providers.push(createOpenAiCompatibleCameraVision({
      id: 'openrouter-camera-vision',
      apiKey: config.openrouterApiKey,
      baseURL: config.providers?.openrouter?.baseUrl ?? 'https://openrouter.ai/api/v1',
      model: primaryModel,
      clientFactory: openAiClientFactory,
    }));
    if (primaryModel !== OPENROUTER_FREE_ROUTER_MODEL) {
      providers.push(createOpenAiCompatibleCameraVision({
        id: 'openrouter-free-router-camera-vision',
        apiKey: config.openrouterApiKey,
        baseURL: config.providers?.openrouter?.baseUrl ?? 'https://openrouter.ai/api/v1',
        model: OPENROUTER_FREE_ROUTER_MODEL,
        clientFactory: openAiClientFactory,
      }));
    }
  }

  if (config.providers?.lmStudio?.enabled && config.providers.lmStudio.visionEnabled && config.providers.lmStudio.visionModel) {
    providers.push(createOpenAiCompatibleCameraVision({
      id: 'lm-studio-camera-vision',
      apiKey: 'lm-studio',
      baseURL: config.providers.lmStudio.baseUrl,
      model: config.providers.lmStudio.visionModel ?? config.providers.lmStudio.model,
      clientFactory: openAiClientFactory,
      locality: 'local',
      timeoutMs: config.providers.lmStudio.timeoutMs,
      maxOutputTokens: 640,
    }));
  }

  return Object.freeze({
    cameraVision: createRoutedCameraVision({
      providers,
      mode: config.inference.mode,
      offline: config.inference.offline,
    }),
    providers: Object.freeze(providers.map((provider) => provider.id)),
  });
}
