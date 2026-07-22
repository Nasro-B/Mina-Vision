const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/u;

export function createYouTubeDataClient({
  apiKey,
  fetchImpl = globalThis.fetch,
  baseUrl = 'https://www.googleapis.com/youtube/v3',
} = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim() || typeof fetchImpl !== 'function') {
    throw new TypeError('youtube_api_configuration_invalid');
  }
  let parsedBase;
  try { parsedBase = new URL(baseUrl); } catch { throw new TypeError('youtube_api_base_url_invalid'); }
  if (parsedBase.protocol !== 'https:' || parsedBase.hostname !== 'www.googleapis.com') {
    throw new TypeError('youtube_api_base_url_invalid');
  }

  const request = async (resource, params, signal) => {
    const url = new URL(`${parsedBase.toString().replace(/\/+$/u, '')}/${resource}`);
    for (const [name, value] of Object.entries({ ...params, key: apiKey })) url.searchParams.set(name, String(value));
    let response;
    try { response = await fetchImpl(url.toString(), { method: 'GET', signal }); }
    catch (error) {
      if (error?.name === 'AbortError') throw error;
      throw new Error('youtube_api_network_error');
    }
    if (!response.ok) throw new Error(`youtube_api_http_${response.status}`);
    try { return await response.json(); } catch { throw new Error('youtube_api_response_invalid'); }
  };

  return Object.freeze({
    async searchVideos(query, { maxResults = 5, signal } = {}) {
      const normalized = String(query ?? '').replace(/\s+/gu, ' ').trim();
      if (!normalized || normalized.length > 200 || !Number.isInteger(maxResults) || maxResults < 1 || maxResults > 10) {
        throw new TypeError('youtube_search_request_invalid');
      }
      const payload = await request('search', {
        part: 'snippet', type: 'video', q: normalized, maxResults, safeSearch: 'moderate',
      }, signal);
      if (!Array.isArray(payload?.items)) throw new Error('youtube_api_response_invalid');
      return payload.items.flatMap((item) => {
        const videoId = item?.id?.videoId;
        const snippet = item?.snippet;
        if (!VIDEO_ID.test(videoId ?? '') || typeof snippet?.title !== 'string' || typeof snippet?.channelTitle !== 'string') return [];
        return [{
          videoId,
          title: snippet.title.slice(0, 300),
          channelTitle: snippet.channelTitle.slice(0, 200),
          publishedAt: typeof snippet.publishedAt === 'string' ? snippet.publishedAt : null,
          thumbnailUrl: typeof snippet.thumbnails?.medium?.url === 'string' ? snippet.thumbnails.medium.url : null,
          url: `https://www.youtube.com/watch?v=${videoId}`,
        }];
      });
    },
    async test({ signal } = {}) {
      const payload = await request('videos', { part: 'id', id: 'jNQXAC9IVRw' }, signal);
      if (!Array.isArray(payload?.items)) throw new Error('youtube_api_response_invalid');
      return Object.freeze({ ok: true, providerId: 'youtube' });
    },
  });
}
