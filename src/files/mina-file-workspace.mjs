import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';

const FILE_CREATION = /(?:cr[ée](?:e|er)?|écri(?:s|re)|enregistr(?:e|er)|sauvegard(?:e|er)|write|create|save).{0,80}(?:fichier|document|file|\.md|\.txt)/iu;
const ABSOLUTE_FILE = /([A-Za-z]:[\\/][^<>"|?*\r\n]+?\.[A-Za-z0-9]{1,10})(?=$|[,;!?\r\n])/u;
const QUOTED_FILE = /["'`]([^\\/:*?"<>|\r\n]{1,180}\.[A-Za-z0-9]{1,10})["'`]/u;
const TOKEN_FILE = /(?:^|\s)([^\s\\/:*?"<>|]{1,180}\.[A-Za-z0-9]{1,10})(?=$|[\s,;!?])/u;

async function snapshot(filename) {
  try {
    const value = await stat(filename);
    return value.isFile() ? Object.freeze({ bytes: value.size, mtimeMs: value.mtimeMs }) : null;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function requestedFile(goal, root) {
  const text = String(goal ?? '');
  const absolute = text.match(ABSOLUTE_FILE)?.[1]?.trim();
  if (absolute) return path.resolve(absolute);
  const relative = text.match(QUOTED_FILE)?.[1] ?? text.match(TOKEN_FILE)?.[1];
  return relative ? path.join(root, path.basename(relative)) : null;
}

export function createMinaFileWorkspace({ root, mkdirDirectory = mkdir } = {}) {
  if (typeof root !== 'string' || !path.isAbsolute(root) || typeof mkdirDirectory !== 'function') {
    throw new TypeError('mina_file_workspace_root_required');
  }
  const resolvedRoot = path.resolve(root);
  const sandboxRoot = path.join(resolvedRoot, 'Sandbox');

  const ensure = async () => {
    await mkdirDirectory(resolvedRoot, { recursive: true });
    await mkdirDirectory(sandboxRoot, { recursive: true });
    return Object.freeze({ root: resolvedRoot, sandboxRoot });
  };

  const prepareMission = async (mission = {}) => {
    const expectedPath = mission.environment === 'desktop' && FILE_CREATION.test(String(mission.goal ?? ''))
      ? requestedFile(mission.goal, resolvedRoot)
      : null;
    if (!expectedPath) return Object.freeze({ mission: Object.freeze({ ...mission }), expectedPath: null, before: null });
    const before = await snapshot(expectedPath);
    const groundedGoal = [
      String(mission.goal).trim(),
      `[CONTRAINTE FICHIER MINA VISION] Destination obligatoire : ${expectedPath}.`,
      `Crée ou modifie réellement ce fichier à ce chemin exact. Ne déclare pas la mission terminée tant que le fichier n'est pas enregistré sur disque.`,
    ].join('\n');
    return Object.freeze({
      mission: Object.freeze({ ...mission, goal: groundedGoal }),
      expectedPath,
      before,
    });
  };

  const verifyMission = async (result, prepared = {}) => {
    if (!prepared.expectedPath || result?.status !== 'completed') return result;
    const after = await snapshot(prepared.expectedPath);
    const changed = after && (!prepared.before
      || after.bytes !== prepared.before.bytes || after.mtimeMs !== prepared.before.mtimeMs);
    if (!changed) throw new Error(`file_creation_not_verified:${prepared.expectedPath}`);
    return Object.freeze({
      ...result,
      fileEvidence: Object.freeze({ path: prepared.expectedPath, bytes: after.bytes, mtimeMs: after.mtimeMs }),
    });
  };

  return Object.freeze({ root: resolvedRoot, sandboxRoot, ensure, prepareMission, verifyMission });
}
