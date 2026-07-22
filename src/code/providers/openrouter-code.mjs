// Adaptateur code OpenRouter : enveloppe le provider OpenAI-compatible réel pointé sur
// OpenRouter (accès aux modèles tiers, dont Claude, via une seule clé).

import { createCodeProviderAdapter } from './code-adapter-core.mjs';

export function createOpenRouterCode({ baseProvider } = {}) {
  if (!baseProvider || typeof baseProvider.invoke !== 'function') {
    throw new TypeError('openrouter_code_base_provider_invalid');
  }
  return createCodeProviderAdapter({
    baseProvider,
    idSuffix: 'code',
    extraInstructions: 'Qualité maximale attendue : raisonner sur les cas limites avant de proposer le patch.',
  });
}
