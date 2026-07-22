// Normalisation stricte des actions du domaine « code » : le modèle ne produit que du JSON,
// jamais un effet direct. Toute action passe ici avant classification et exécution — allowlist
// de types, validation champ par champ, chemins confinés au projectRoot, erreurs nominées.

const ALLOWED_TYPES = new Set([
  'code.read',
  'code.write',
  'code.delete',
  'code.search',
  'code.test.run',
  'code.test.generate',
  'code.git.status',
  'code.git.diff',
  'code.git.commit',
  'code.git.log',
  'code.plan.create',
  'code.plan.update',
  'code.refactor',
  'code.review',
  'code.sandbox.run',
  'code.diff.apply',
  'code.format',
  'code.lint',
]);

const FORBIDDEN_ARGUMENTS = new Set(['shell', 'powershell', 'cmd', 'executable', 'sudo']);

const MAX_PATH_CHARS = 4_000;
const MAX_CONTENT_CHARS = 1_000_000;
const MAX_MESSAGE_CHARS = 500;
const MAX_QUERY_CHARS = 2_000;

function requireString(value, field, maxLength) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`code_action_invalid: ${field} requis`);
  }
  if (value.length > maxLength) throw new Error(`code_action_invalid: ${field} trop long`);
  return value;
}

// Chemin relatif au projet, jamais absolu, jamais d'échappement par « .. », jamais d'octet nul.
export function normalizeProjectPath(value, field = 'path') {
  const raw = requireString(value, field, MAX_PATH_CHARS);
  if (raw.includes('\0')) throw new Error(`code_action_invalid: ${field} contient un octet nul`);
  const forward = raw.replace(/\\/gu, '/');
  if (/^[a-z]:\//iu.test(forward) || forward.startsWith('/') || forward.startsWith('~')) {
    throw new Error(`code_action_invalid: ${field} doit être relatif au projet`);
  }
  const segments = forward.split('/').filter((segment) => segment !== '' && segment !== '.');
  if (segments.some((segment) => segment === '..')) {
    throw new Error(`code_action_invalid: ${field} sort du projet`);
  }
  if (segments.length === 0) throw new Error(`code_action_invalid: ${field} vide`);
  return segments.join('/');
}

export function normalizeCodeAction(functionCall) {
  const type = functionCall?.type ?? functionCall?.name;
  const args = functionCall?.arguments ?? functionCall?.args ?? {};

  if (!ALLOWED_TYPES.has(type)) throw new Error(`code_action_unknown: ${type}`);
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    throw new Error('code_action_invalid: arguments requis');
  }
  for (const key of Object.keys(args)) {
    if (FORBIDDEN_ARGUMENTS.has(key.toLowerCase())) {
      throw new Error(`code_action_invalid: argument interdit ${key}`);
    }
  }

  const action = {
    type,
    intent: typeof args.intent === 'string' ? args.intent.slice(0, MAX_MESSAGE_CHARS) : '',
  };

  switch (type) {
    case 'code.read':
    case 'code.delete':
    case 'code.format':
    case 'code.lint':
      action.path = normalizeProjectPath(args.path);
      break;
    case 'code.write': {
      action.path = normalizeProjectPath(args.path);
      action.content = requireString(args.content, 'content', MAX_CONTENT_CHARS);
      break;
    }
    case 'code.diff.apply':
      action.patch = requireString(args.patch, 'patch', MAX_CONTENT_CHARS);
      break;
    case 'code.search':
      action.query = requireString(args.query, 'query', MAX_QUERY_CHARS);
      if (args.maxResults !== undefined) {
        const max = Number(args.maxResults);
        if (!Number.isInteger(max) || max < 1 || max > 100) {
          throw new Error('code_action_invalid: maxResults hors limites');
        }
        action.maxResults = max;
      }
      break;
    case 'code.test.run':
      if (args.file !== undefined) action.file = normalizeProjectPath(args.file, 'file');
      break;
    case 'code.test.generate':
      action.path = normalizeProjectPath(args.path);
      if (args.symbol !== undefined) action.symbol = requireString(args.symbol, 'symbol', 200);
      break;
    case 'code.git.commit':
      action.message = requireString(args.message, 'message', MAX_MESSAGE_CHARS);
      if (args.files !== undefined) {
        if (!Array.isArray(args.files) || args.files.length === 0 || args.files.length > 200) {
          throw new Error('code_action_invalid: files invalide');
        }
        action.files = args.files.map((file) => normalizeProjectPath(file, 'files'));
      }
      break;
    case 'code.git.diff':
    case 'code.git.log':
      if (args.file !== undefined) action.file = normalizeProjectPath(args.file, 'file');
      break;
    case 'code.git.status':
      break;
    case 'code.plan.create':
      action.title = requireString(args.title, 'title', MAX_MESSAGE_CHARS);
      if (args.steps !== undefined) {
        if (!Array.isArray(args.steps) || args.steps.length > 50) {
          throw new Error('code_action_invalid: steps invalide');
        }
        action.steps = args.steps.map((step) => requireString(step?.description ?? step, 'step', MAX_MESSAGE_CHARS));
      }
      break;
    case 'code.plan.update':
      action.planId = requireString(args.planId ?? args.id, 'planId', 200);
      action.stepId = requireString(args.stepId, 'stepId', 200);
      action.status = requireString(args.status, 'status', 40);
      break;
    case 'code.refactor':
      action.description = requireString(args.description, 'description', MAX_QUERY_CHARS);
      break;
    case 'code.review':
      if (args.files !== undefined) {
        if (!Array.isArray(args.files) || args.files.length === 0 || args.files.length > 200) {
          throw new Error('code_action_invalid: files invalide');
        }
        action.files = args.files.map((file) => normalizeProjectPath(file, 'files'));
      }
      break;
    case 'code.sandbox.run': {
      action.language = requireString(args.language, 'language', 40).toLowerCase();
      if (!['python', 'javascript', 'powershell'].includes(action.language)) {
        throw new Error(`code_action_invalid: language non supporté ${action.language}`);
      }
      action.source = requireString(args.source ?? args.code, 'source', MAX_CONTENT_CHARS);
      break;
    }
    default:
      throw new Error(`code_action_unknown: ${type}`);
  }

  if (typeof args.command === 'string') action.command = args.command.slice(0, MAX_QUERY_CHARS);
  return Object.freeze(action);
}
