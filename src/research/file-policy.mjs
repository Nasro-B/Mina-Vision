import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const FORBIDDEN_NAMES = new Set([
  'cookies',
  'credentials',
  'credentials.json',
  'keyring.json',
  'keyring.sqlite',
  'login data',
  'token-cache.json',
  'tokens.json',
  'web data',
]);
const FORBIDDEN_EXTENSIONS = new Set(['.kdbx']);
const FORBIDDEN_SEGMENTS = new Set(['1password', 'bitwarden', 'keepass', 'password managers']);

function comparable(path) {
  const normalized = resolve(path);
  return process.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized;
}

function isWithin(root, candidate) {
  const fromRoot = relative(comparable(root), comparable(candidate));
  return fromRoot === '' || (!fromRoot.startsWith(`..${sep}`) && fromRoot !== '..' && !isAbsolute(fromRoot));
}

// Task 4 (R-03) : motifs credentials supplémentaires — clients OAuth, comptes de service,
// clés privées et caches de tokens sont interdits par leur chemin, où qu'ils soient.
const FORBIDDEN_NAME_PATTERNS = [
  /^client_secret.*\.json$/u,
  /service[-_]?account.*\.json$/u,
  /^(?:token[-_]?cache|refresh[-_]?token).*\.json$/u,
];
const FORBIDDEN_PATH_EXTENSIONS = new Set(['.kdbx', '.pem', '.pfx', '.p12', '.key']);

function rejectSensitivePath(path) {
  const parts = path.split(/[\\/]/u).filter(Boolean).map((part) => part.toLocaleLowerCase('en-US'));
  const name = parts.at(-1) ?? '';
  if (name === '.env' || name.startsWith('.env.') || FORBIDDEN_NAMES.has(name)
    || FORBIDDEN_EXTENSIONS.has(name.slice(name.lastIndexOf('.')))
    || FORBIDDEN_PATH_EXTENSIONS.has(name.slice(name.lastIndexOf('.')))
    || FORBIDDEN_NAME_PATTERNS.some((pattern) => pattern.test(name))
    || parts.some((part) => FORBIDDEN_SEGMENTS.has(part))) {
    throw new Error('sensitive_file_forbidden');
  }
}

export async function createFilePolicy({
  approvedRoots = [],
  fileSystem = { realpath, stat },
} = {}) {
  const canonicalRoots = [];
  for (const root of approvedRoots) {
    const canonical = await fileSystem.realpath(resolve(root));
    const info = await fileSystem.stat(canonical);
    if (!info.isDirectory()) throw new TypeError('approved_root_must_be_directory');
    canonicalRoots.push(canonical);
  }

  async function authorize({ path, operation, confirmed = false } = {}) {
    if (!path || !['index', 'read'].includes(operation)) throw new TypeError('invalid_file_request');
    const requested = resolve(path);
    if (requested.startsWith('\\\\')) throw new Error('network_path_forbidden');
    const canonical = await fileSystem.realpath(requested);
    rejectSensitivePath(canonical);
    const approved = canonicalRoots.some((root) => isWithin(root, canonical));
    if (operation === 'index' && !approved) throw new Error('file_outside_approved_roots');
    if (operation === 'read' && !approved && confirmed !== true) throw new Error('file_confirmation_required');
    return canonical;
  }

  return Object.freeze({ authorize, approvedRoots: Object.freeze([...canonicalRoots]) });
}
