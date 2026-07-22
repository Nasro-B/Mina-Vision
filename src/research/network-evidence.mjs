import { createHash } from 'node:crypto';

const SENSITIVE_KEY = /^(?:authorization|cookie|set-cookie|proxy-authorization|password|passwd|secret|token|access[_-]?token|refresh[_-]?token|api[_-]?key|x-api-key|code)$/iu;

export function sanitizePublicUrl(value) {
  const url = new URL(value);
  for (const key of [...url.searchParams.keys()]) {
    if (SENSITIVE_KEY.test(key)) url.searchParams.set(key, '[REDACTED]');
  }
  url.username = '';
  url.password = '';
  return url.toString();
}

export function redactSensitiveValue(value, key = '') {
  if (SENSITIVE_KEY.test(key)) return '[REDACTED]';
  if (Array.isArray(value)) return value.map((item) => redactSensitiveValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [
      childKey,
      redactSensitiveValue(child, childKey),
    ]));
  }
  if (typeof value === 'string') return redactSensitiveText(value);
  return value;
}

export function redactSensitiveText(value) {
  return String(value)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, 'Bearer [REDACTED]')
    .replace(/((?:textbox|input|champ)\s+["'](?:mot de passe|password|passwd)["']\s*:\s*)[^\r\n]+/giu, '$1[REDACTED]')
    .replace(/([?&](?:amp;)?(?:password|passwd|secret|token|access[_-]?token|refresh[_-]?token|api[_-]?key|authorization)=)[^&"'\s<>)]+/giu, '$1[REDACTED]')
    .replace(/((?:["']?(?:password|passwd|secret|token|access[_-]?token|refresh[_-]?token|api[_-]?key|authorization)["']?)\s*:\s*)(["'])[^"']*\2/giu, '$1"[REDACTED]"')
    .replace(/((?:password|passwd|secret|token|access[_-]?token|refresh[_-]?token|api[_-]?key|authorization)\s*=\s*)(["'])[^"']*\2/giu, '$1"[REDACTED]"');
}

export function redactTargetedHtml(value) {
  return redactSensitiveText(String(value))
    .replace(/(<input\b[^>]*\btype=["']password["'][^>]*\bvalue=)(["'])[^"']*\2/giu, '$1"[REDACTED]"')
    .replace(/\s(?:data-)?(?:token|secret|password|api-key)=(['"])[^'"]*\1/giu, ' data-redacted="[REDACTED]"');
}

function evidence({ url, body, capturedAt }) {
  const digest = createHash('sha256').update(body).digest('hex');
  return Object.freeze({
    sourceId: `network-${digest.slice(0, 24)}`,
    locator: url,
    capturedAt,
    contentDigest: `sha256:${digest}`,
    freshnessClass: 'current',
    extract: body.slice(0, 4_000),
    method: 'structured_extraction',
  });
}

export async function captureNetworkResponse(response, {
  clock = Date.now,
  maxBodyBytes = 1024 * 1024,
} = {}) {
  const headers = redactSensitiveValue(await response.allHeaders());
  const contentType = String(headers['content-type'] ?? '');
  if (!/(?:application\/json|text\/plain)/iu.test(contentType)) return null;
  const requestHeaders = await response.request().allHeaders();
  const authenticated = Object.keys(requestHeaders).some((key) => /^(?:authorization|cookie)$/iu.test(key));
  const url = sanitizePublicUrl(response.url());
  let body = '[AUTHENTICATED_RESPONSE_NOT_STORED]';
  if (!authenticated) {
    const bytes = await response.body();
    if (bytes.length > maxBodyBytes) return null;
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (/application\/json/iu.test(contentType)) {
      body = JSON.stringify(redactSensitiveValue(JSON.parse(raw)));
    } else {
      body = redactSensitiveText(raw);
    }
  }
  const capturedAt = new Date(Number(typeof clock === 'function' ? clock() : clock.now())).toISOString();
  return Object.freeze({ url, status: response.status(), headers, body, authenticated, evidence: evidence({ url, body, capturedAt }) });
}
