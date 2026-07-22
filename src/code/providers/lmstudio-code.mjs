// Adaptateur code LM Studio : exécution 100 % locale (offline), coût nul. Enveloppe le
// provider LM Studio réel — le modèle chargé localement est celui que LM Studio expose.

import { createCodeProviderAdapter } from './code-adapter-core.mjs';

export function createLmStudioCode({ baseProvider } = {}) {
  if (!baseProvider || baseProvider.locality !== 'local') {
    throw new TypeError('lmstudio_code_base_provider_invalid');
  }
  return createCodeProviderAdapter({
    baseProvider,
    idSuffix: 'code',
    extraInstructions: 'Contexte réduit : rester concis, un seul patch ciblé par réponse.',
  });
}
