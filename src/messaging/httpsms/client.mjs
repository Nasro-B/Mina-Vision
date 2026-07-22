import { SEND_ENDPOINT, STATUS_ENDPOINT, validateSendRequest } from './contracts.mjs';

// Reads a fetch Response body as text while enforcing a hard byte cap — a naive `response.text()`
// would buffer an arbitrarily large body before we ever get to inspect it.
async function readBounded(response, maxBytes) {
  if (!response.body?.getReader) return response.text();
  const reader = response.body.getReader();
  let received = 0;
  const chunks = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) throw new Error('httpsms_response_too_large');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
}

export function createHttpsmsClient({
  baseUrl,
  apiKey,
  fetch: fetchImpl = globalThis.fetch,
  timeoutMs = 10_000,
  maxResponseBytes = 1_000_000,
} = {}) {
  if (!baseUrl || !apiKey || typeof fetchImpl !== 'function') throw new TypeError('httpsms_client_configuration_invalid');

  async function request(path, { method = 'GET', body } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        // The key is only ever placed in a header, never logged, never in a query string.
        headers: { 'x-api-key': apiKey, ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('httpsms_timeout');
      throw new Error('httpsms_network_error');
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 401 || response.status === 403) throw new Error('httpsms_unauthorized');
    const text = await readBounded(response, maxResponseBytes);
    if (!response.ok) throw new Error(`httpsms_request_failed:${response.status}`);
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      throw new Error('httpsms_response_invalid');
    }
  }

  return Object.freeze({
    // No implicit retry, ever: a caller who wants to retry a send must pass a fresh call with the
    // SAME requestId (idempotent on the httpSMS side) — this client never doubles a send on its own.
    send: async (input) => {
      const validated = validateSendRequest(input);
      return request(SEND_ENDPOINT, {
        method: 'POST',
        body: { from: validated.from, to: validated.to, content: validated.content, request_id: validated.requestId },
      });
    },
    getStatus: (id) => request(STATUS_ENDPOINT(id)),
    // Reachability probe only: any HTTP response (even an error status) proves the network path
    // works. Only a transport-level failure (refused connection, timeout, DNS) means unreachable.
    health: async () => {
      try {
        await request('/');
        return Object.freeze({ reachable: true });
      } catch (error) {
        if (error.message === 'httpsms_unauthorized' || error.message?.startsWith('httpsms_request_failed:')) {
          return Object.freeze({ reachable: true });
        }
        return Object.freeze({ reachable: false, reason: error.message });
      }
    },
  });
}
