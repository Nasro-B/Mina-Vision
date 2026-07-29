import { describe, expect, it } from 'vitest';
import { COMFYUI_LIMITS, normalizeComfyUiRequest } from '../src/publication/comfyui-workflow-schema.mjs';

describe('comfyui-workflow-schema', () => {
  it('normalise une requête valide (taille multiple de 64, dans les bornes)', () => {
    const request = normalizeComfyUiRequest({ prompt: 'un chat', modelId: 'sdxl', width: 800, height: 900, steps: 20, seed: 7 });
    expect(request.width % COMFYUI_LIMITS.sizeStep).toBe(0);
    expect(request.width).toBeGreaterThanOrEqual(COMFYUI_LIMITS.minSize);
    expect(request.width).toBeLessThanOrEqual(COMFYUI_LIMITS.maxSize);
    expect(request.steps).toBe(20);
    expect(request.seed).toBe(7);
    expect(request.provenance).toBeUndefined();
  });

  it('borne les extrêmes (taille clampée, steps plafonnés, seed négatif → 0)', () => {
    const request = normalizeComfyUiRequest({ prompt: 'x', modelId: 'm', width: 4000, height: 100, steps: 999, seed: -5 });
    expect(request.width).toBe(COMFYUI_LIMITS.maxSize);
    expect(request.height).toBe(COMFYUI_LIMITS.minSize);
    expect(request.steps).toBe(COMFYUI_LIMITS.maxSteps);
    expect(request.seed).toBe(0);
  });

  it('exige prompt et modelId (Mina ne télécharge aucun modèle)', () => {
    expect(() => normalizeComfyUiRequest({ modelId: 'm' })).toThrow('comfyui_prompt_required');
    expect(() => normalizeComfyUiRequest({ prompt: 'x' })).toThrow('comfyui_model_required');
  });

  it('tronque prompt et negative prompt', () => {
    const request = normalizeComfyUiRequest({ prompt: 'a'.repeat(2_000), negativePrompt: 'b'.repeat(2_000), modelId: 'm' });
    expect(request.prompt.length).toBe(COMFYUI_LIMITS.promptMax);
    expect(request.negativePrompt.length).toBe(COMFYUI_LIMITS.negativeMax);
  });
});
