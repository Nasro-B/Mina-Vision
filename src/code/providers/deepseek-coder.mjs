// Adaptateur code DeepSeek : enveloppe le provider DeepSeek réel (src/providers/deepseek.mjs,
// modèles réels deepseek-v4-flash / deepseek-v4-pro — PAS les noms spéculatifs de la spec).

import { createCodeProviderAdapter } from './code-adapter-core.mjs';

export function createDeepSeekCoder({ baseProvider } = {}) {
  if (baseProvider?.id !== 'deepseek') throw new TypeError('deepseek_coder_base_provider_invalid');
  return createCodeProviderAdapter({
    baseProvider,
    idSuffix: 'code',
    extraInstructions: 'Optimise pour des patchs précis et compacts. Explique en une ligne avant le patch.',
  });
}
