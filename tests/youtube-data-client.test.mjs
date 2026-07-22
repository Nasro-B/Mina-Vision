import { describe, expect, it, vi } from 'vitest';
import { createYouTubeDataClient } from '../src/media/youtube-data-client.mjs';

describe('YouTube Data API v3 client', () => {
  it('returns bounded video results with direct watch URLs', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      items: [{
        id: { videoId: 'abcDEF_1234' },
        snippet: {
          title: 'Titre test', channelTitle: 'Chaîne test', publishedAt: '2026-07-18T00:00:00Z',
          thumbnails: { medium: { url: 'https://i.ytimg.com/example.jpg' } },
        },
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const client = createYouTubeDataClient({ apiKey: 'secret-key', fetchImpl });

    await expect(client.searchVideos('musique algérienne', { maxResults: 3 })).resolves.toEqual([{
      videoId: 'abcDEF_1234', title: 'Titre test', channelTitle: 'Chaîne test',
      publishedAt: '2026-07-18T00:00:00Z', thumbnailUrl: 'https://i.ytimg.com/example.jpg',
      url: 'https://www.youtube.com/watch?v=abcDEF_1234',
    }]);
    const requested = new URL(fetchImpl.mock.calls[0][0]);
    expect(requested.pathname).toBe('/youtube/v3/search');
    expect(requested.searchParams.get('q')).toBe('musique algérienne');
    expect(requested.searchParams.get('key')).toBe('secret-key');
    expect(requested.searchParams.get('type')).toBe('video');
  });

  it('never exposes the API key in failures', async () => {
    const client = createYouTubeDataClient({
      apiKey: 'do-not-leak',
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ error: { message: 'bad key do-not-leak' } }), { status: 403 })),
    });
    const error = await client.searchVideos('test').catch((reason) => reason);
    expect(error.message).toBe('youtube_api_http_403');
    expect(error.message).not.toContain('do-not-leak');
  });

  it('uses a one-unit videos.list request for provider health', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ items: [{ id: 'jNQXAC9IVRw' }] }), { status: 200 }));
    const client = createYouTubeDataClient({ apiKey: 'secret-key', fetchImpl });
    await expect(client.test()).resolves.toEqual({ ok: true, providerId: 'youtube' });
    expect(new URL(fetchImpl.mock.calls[0][0]).pathname).toBe('/youtube/v3/videos');
  });
});
