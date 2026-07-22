const ENV_LINE = /^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(.*)$/u;
const SECRET_NAME = /(?:API_?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|PRIVATE_?KEY)/iu;

function decodeValue(raw) {
  const value = raw.trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try { return JSON.parse(value); } catch { return value.slice(1, -1); }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/\\'/gu, "'");
  return value.replace(/\s+#.*$/u, '').trim();
}

function encodeValue(value, previous = '') {
  const text = String(value);
  const leading = previous.match(/^\s*/u)?.[0] ?? '';
  const trailing = previous.match(/\s*$/u)?.[0] ?? '';
  const trimmed = previous.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) return `${leading}${JSON.stringify(text)}${trailing}`;
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return `${leading}'${text.replaceAll("'", "\\'")}'${trailing}`;
  }
  if (/\s|#/u.test(text)) return `${leading}${JSON.stringify(text)}${trailing}`;
  return `${leading}${text}${trailing}`;
}

function splitDocument(text) {
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const finalNewline = text.endsWith('\n');
  const lines = text.split(/\r?\n/u);
  if (finalNewline) lines.pop();
  return { newline, finalNewline, lines };
}

export function parseEnvDocument(text = '') {
  const { newline, lines } = splitDocument(String(text));
  const values = {};
  for (const line of lines) {
    const match = line.match(ENV_LINE);
    if (!match || SECRET_NAME.test(match[2])) continue;
    values[match[2]] = decodeValue(match[4]);
  }
  return Object.freeze({ newline, values: Object.freeze(values) });
}

export function updateEnvDocument(text = '', patch = {}, { allowedKeys } = {}) {
  if (!(allowedKeys instanceof Set)) throw new TypeError('env_allowed_keys_required');
  const document = splitDocument(String(text));
  const lastIndex = new Map();
  document.lines.forEach((line, index) => {
    const match = line.match(ENV_LINE);
    if (match) lastIndex.set(match[2], index);
  });

  for (const [key, value] of Object.entries(patch)) {
    if (!allowedKeys.has(key) || SECRET_NAME.test(key)) throw new Error(`env_key_not_editable:${key}`);
    const index = lastIndex.get(key);
    if (index === undefined) {
      document.lines.push(`${key}=${encodeValue(value)}`);
      continue;
    }
    const match = document.lines[index].match(ENV_LINE);
    document.lines[index] = `${match[1]}${match[2]}${match[3]}${encodeValue(value, match[4])}`;
  }

  const content = document.lines.join(document.newline);
  return `${content}${document.finalNewline || Object.keys(patch).some((key) => !lastIndex.has(key)) ? document.newline : ''}`;
}

export function createEnvDocumentStore({ path, readText, writeAtomic, allowedKeys } = {}) {
  if (!path || typeof readText !== 'function' || typeof writeAtomic !== 'function') {
    throw new TypeError('env_document_store_configuration_required');
  }
  return Object.freeze({
    async update(patch) {
      const current = await readText(path);
      const next = updateEnvDocument(current, patch, { allowedKeys });
      await writeAtomic(path, next);
      return parseEnvDocument(next);
    },
  });
}
