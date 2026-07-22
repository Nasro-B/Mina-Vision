import { win32 as path } from 'node:path';

const FILE_MUTATION = /(?:cr[ée](?:e|er)?|écri(?:s|re|ture)|modifi(?:e|er)|enregistr(?:e|er)|sauvegard(?:e|er)|télécharg(?:e|er)|supprim(?:e|er)|déplac(?:e|er)|copi(?:e|er)|renomm(?:e|er)|write|create|save|delete|move|copy|rename|download)/iu;
const DRIVE_PATH = /[A-Za-z]:[\\/]/gu;

function normalize(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.startsWith('\\\\')) {
    throw new TypeError('absolute_local_write_path_required');
  }
  return path.resolve(value);
}

function comparable(value) {
  return normalize(value).replaceAll('/', '\\').toLocaleLowerCase('en-US').replace(/\\+$/u, '');
}

function within(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}\\`);
}

export function createHostWritePolicy({ trustedRoots = [], confirmLocal } = {}) {
  if (!Array.isArray(trustedRoots) || trustedRoots.length < 1 || typeof confirmLocal !== 'function') {
    throw new TypeError('host_write_policy_dependencies_required');
  }
  const roots = Object.freeze([...new Set(trustedRoots.map(comparable))]);

  const classify = (filename) => {
    const candidate = comparable(filename);
    return roots.some((root) => within(root, candidate)) ? 'allow' : 'confirm';
  };

  const authorize = async (filename) => {
    const resolved = normalize(filename);
    if (classify(resolved) === 'allow') return resolved;
    const approved = await confirmLocal({
      reason: `Mina Vision veut écrire hors de son environnement : ${resolved}`,
      action: { name: 'files.write', path: resolved },
    });
    if (!approved) throw new Error('host_write_confirmation_refused');
    return resolved;
  };

  const requiresMissionConfirmation = ({ goal, environment } = {}) => {
    const text = String(goal ?? '');
    if (!FILE_MUTATION.test(text)) return false;
    const matches = [...text.matchAll(DRIVE_PATH)];
    if (matches.length === 0) return environment === 'desktop';
    const normalizedText = text.replaceAll('/', '\\').toLocaleLowerCase('en-US');
    return matches.some((match) => {
      const tail = normalizedText.slice(match.index);
      return !roots.some((root) => within(root, tail) || tail.startsWith(`${root}\\`));
    });
  };

  return Object.freeze({ classify, authorize, requiresMissionConfirmation, trustedRoots: roots });
}
