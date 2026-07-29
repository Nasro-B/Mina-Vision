import { createHash } from 'node:crypto';
import { detectMediaType } from './asset-policy.mjs';
import { normalizeComfyUiRequest } from './comfyui-workflow-schema.mjs';

// Fournisseur de génération photo LOCALE via ComfyUI. Trois gardes non négociables :
//   1) l'endpoint DOIT être une boucle locale (127.0.0.1 / localhost) — construire le fournisseur
//      avec autre chose jette `comfyui_base_url_not_loopback` (jamais de LAN, jamais de cloud) ;
//   2) désactivé par défaut — `generate()` jette `comfyui_disabled` tant qu'il n'est pas explicitement activé ;
//   3) l'image renvoyée est validée par ses magic bytes (PNG/WebP) et bornée en taille.
// Mina ne télécharge aucun modèle : ComfyUI, son workflow et son modèle doivent déjà être installés.

const LOOPBACK = /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\/?$/u;
const ALLOWED_OUTPUT = new Set(['image/png', 'image/webp']);
const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;

export function createComfyUiImageProvider({
  baseUrl, fetch, enabled = false, timeoutMs = 180_000, maxBytes = MAX_OUTPUT_BYTES,
} = {}) {
  if (typeof baseUrl !== 'string' || !LOOPBACK.test(baseUrl)) throw new Error('comfyui_base_url_not_loopback');
  if (typeof fetch !== 'function') throw new TypeError('comfyui_fetch_required');
  const root = baseUrl.replace(/\/$/u, '');

  async function fetchImage(request) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetch(`${root}/mina/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal: controller?.signal,
      });
      if (!response?.ok) throw new Error('comfyui_request_failed');
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return Object.freeze({
    async health() {
      if (!enabled) return { ready: false, reason: 'comfyui_disabled' };
      try {
        const response = await fetch(`${root}/system_stats`, { method: 'GET' });
        return response?.ok ? { ready: true, reason: null } : { ready: false, reason: 'comfyui_unreachable' };
      } catch {
        return { ready: false, reason: 'comfyui_unreachable' };
      }
    },

    async generate(input) {
      if (!enabled) throw new Error('comfyui_disabled');
      const request = normalizeComfyUiRequest(input);
      const bytes = await fetchImage(request);
      if (!bytes || bytes.length === 0) throw new Error('comfyui_empty_output');
      if (bytes.length > maxBytes) throw new Error('comfyui_output_too_large');
      const mimeType = detectMediaType(bytes);
      if (!mimeType || !ALLOWED_OUTPUT.has(mimeType)) throw new Error('comfyui_output_media_type_invalid');
      return Object.freeze({
        bytes,
        mimeType,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        provenance: 'comfyui-local',
        modelId: request.modelId,
        seed: request.seed,
      });
    },
  });
}
