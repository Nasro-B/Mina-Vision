// Adaptateur code Gemini : enveloppe le provider texte Gemini réel de Mina Vision.

import { createCodeProviderAdapter } from './code-adapter-core.mjs';

export function createGeminiCode({ baseProvider } = {}) {
  if (!baseProvider?.id?.startsWith('gemini')) throw new TypeError('gemini_code_base_provider_invalid');
  return createCodeProviderAdapter({
    baseProvider,
    idSuffix: 'code',
    extraInstructions: 'Réponse structurée : diagnostic bref, puis patch Mina, puis vérification proposée.',
  });
}
