// Contrat borné d'une demande de génération photo locale via ComfyUI. Aucune valeur libre : largeur
// et hauteur multiples de 64 entre 512 et 1024, 1 à 30 étapes, seed entier positif, prompt ≤ 1000
// caractères, negative prompt ≤ 500. Mina ne télécharge JAMAIS de modèle : le modelId doit désigner
// un modèle déjà déclaré localement. Ce schéma existe pour que rien d'illimité n'atteigne le worker.

export const COMFYUI_LIMITS = Object.freeze({
  minSize: 512, maxSize: 1024, sizeStep: 64,
  minSteps: 1, maxSteps: 30, promptMax: 1_000, negativeMax: 500,
});

function clampSize(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const stepped = Math.round(number / COMFYUI_LIMITS.sizeStep) * COMFYUI_LIMITS.sizeStep;
  return Math.min(Math.max(stepped, COMFYUI_LIMITS.minSize), COMFYUI_LIMITS.maxSize);
}

export function normalizeComfyUiRequest(input = {}) {
  if (!input || typeof input !== 'object') throw new Error('comfyui_request_invalid');
  const prompt = String(input.prompt ?? '').trim();
  if (!prompt) throw new Error('comfyui_prompt_required');
  const modelId = String(input.modelId ?? '').trim();
  if (!modelId) throw new Error('comfyui_model_required');
  const steps = Math.min(Math.max(Math.round(Number(input.steps) || COMFYUI_LIMITS.minSteps), COMFYUI_LIMITS.minSteps), COMFYUI_LIMITS.maxSteps);
  const seedRaw = Number(input.seed);
  const seed = Number.isInteger(seedRaw) && seedRaw >= 0 ? seedRaw : 0;
  return Object.freeze({
    prompt: prompt.slice(0, COMFYUI_LIMITS.promptMax),
    negativePrompt: String(input.negativePrompt ?? '').slice(0, COMFYUI_LIMITS.negativeMax),
    width: clampSize(input.width, COMFYUI_LIMITS.minSize),
    height: clampSize(input.height, COMFYUI_LIMITS.minSize),
    steps,
    seed,
    modelId,
  });
}
