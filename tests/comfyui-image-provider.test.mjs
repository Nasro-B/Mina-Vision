import { describe, expect, it, vi } from 'vitest';
import { createComfyUiImageProvider } from '../src/publication/comfyui-image-provider.mjs';

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const validRequest = { prompt: 'un chat', modelId: 'sdxl', width: 768, height: 768, steps: 20, seed: 42 };

function okFetch(bytes = PNG_1x1) {
  return vi.fn(async () => ({
    ok: true,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  }));
}

describe('comfyui-image-provider', () => {
  it('refuse un endpoint non-loopback (jamais de LAN ni de cloud)', () => {
    expect(() => createComfyUiImageProvider({ baseUrl: 'http://192.168.1.10:8188', enabled: true, fetch: okFetch() }))
      .toThrow('comfyui_base_url_not_loopback');
    expect(() => createComfyUiImageProvider({ baseUrl: 'https://comfy.example.com', enabled: true, fetch: okFetch() }))
      .toThrow('comfyui_base_url_not_loopback');
  });

  it('accepte 127.0.0.1 et localhost', () => {
    expect(() => createComfyUiImageProvider({ baseUrl: 'http://127.0.0.1:8188', enabled: true, fetch: okFetch() })).not.toThrow();
    expect(() => createComfyUiImageProvider({ baseUrl: 'http://localhost:8188', enabled: true, fetch: okFetch() })).not.toThrow();
  });

  it('refuse toute génération si désactivé (défaut)', async () => {
    const provider = createComfyUiImageProvider({ baseUrl: 'http://127.0.0.1:8188', fetch: okFetch() });
    await expect(provider.generate(validRequest)).rejects.toThrow('comfyui_disabled');
    expect(await provider.health()).toEqual({ ready: false, reason: 'comfyui_disabled' });
  });

  it('génère une image PNG locale avec provenance comfyui-local quand activé', async () => {
    const provider = createComfyUiImageProvider({ baseUrl: 'http://127.0.0.1:8188', enabled: true, fetch: okFetch() });
    const result = await provider.generate(validRequest);
    expect(result).toMatchObject({ mimeType: 'image/png', provenance: 'comfyui-local', modelId: 'sdxl', seed: 42 });
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('interdit les redirections HTTP afin qu’un endpoint loopback ne puisse jamais sortir du loopback', async () => {
    const fetch = okFetch();
    const provider = createComfyUiImageProvider({ baseUrl: 'http://127.0.0.1:8188', enabled: true, fetch });

    await provider.generate(validRequest);
    await provider.health();

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:8188/mina/generate', expect.objectContaining({ redirect: 'error' }));
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:8188/system_stats', expect.objectContaining({ redirect: 'error' }));
  });

  it('refuse une sortie qui n’est pas une image validée (magic bytes)', async () => {
    const provider = createComfyUiImageProvider({ baseUrl: 'http://127.0.0.1:8188', enabled: true, fetch: okFetch(Buffer.from('MZ ceci n_est pas une image')) });
    await expect(provider.generate(validRequest)).rejects.toThrow('comfyui_output_media_type_invalid');
  });
});
