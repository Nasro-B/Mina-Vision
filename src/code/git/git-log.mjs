// Historique Git : log parsé avec séparateurs de champ/enregistrement unitaires (US/RS,
// insensibles au contenu des messages) et blame par ligne (--line-porcelain).

const FIELD = String.fromCharCode(31); // US — separateur de champ
const RECORD = String.fromCharCode(30); // RS — separateur d enregistrement

export function parseLog(output) {
  return Object.freeze(String(output ?? '')
    .split(RECORD)
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash, author, date, subject] = record.split(FIELD);
      return Object.freeze({
        hash: hash?.trim() ?? '',
        shortHash: (hash?.trim() ?? '').slice(0, 7),
        author: author ?? '',
        date: date ?? '',
        subject: subject ?? '',
      });
    }));
}

export function parseBlame(output) {
  const lines = [];
  let current = null;
  for (const raw of String(output ?? '').split('\n')) {
    const headerMatch = raw.match(/^([0-9a-f]{40})\s+\d+\s+(\d+)/u);
    if (headerMatch) {
      current = { hash: headerMatch[1], shortHash: headerMatch[1].slice(0, 7), line: Number(headerMatch[2]), author: '', content: '' };
      continue;
    }
    if (!current) continue;
    if (raw.startsWith('author ')) current.author = raw.slice('author '.length);
    else if (raw.startsWith('\t')) {
      current.content = raw.slice(1);
      lines.push(Object.freeze(current));
      current = null;
    }
  }
  return Object.freeze(lines);
}

export function createGitLog({ gitClient } = {}) {
  if (!gitClient) throw new TypeError('git_log_client_required');

  return Object.freeze({
    async log({ maxCount = 20, file, author } = {}) {
      const bounded = Math.min(Math.max(1, Number(maxCount) || 20), 500);
      const args = ['log', `--max-count=${bounded}`, `--pretty=format:%H${FIELD}%an${FIELD}%aI${FIELD}%s${RECORD}`];
      if (author) args.push(`--author=${author}`);
      if (file) args.push('--', file);
      return parseLog(await gitClient.raw(args));
    },

    async blame(filePath) {
      if (typeof filePath !== 'string' || filePath.length === 0) throw new Error('git_log_file_required');
      return parseBlame(await gitClient.raw(['blame', '--line-porcelain', '--', filePath]));
    },
  });
}
