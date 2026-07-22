// Lecture de diff Git : texte unifié + numstat parsé (ajouts/suppressions par fichier).

export function parseNumstat(output) {
  const entries = [];
  for (const line of String(output ?? '').split('\n')) {
    const match = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/u);
    if (!match) continue;
    entries.push(Object.freeze({
      file: match[3],
      additions: match[1] === '-' ? null : Number(match[1]),
      deletions: match[2] === '-' ? null : Number(match[2]),
      binary: match[1] === '-',
    }));
  }
  return Object.freeze(entries);
}

export function createGitDiff({ gitClient } = {}) {
  if (!gitClient) throw new TypeError('git_diff_client_required');

  const buildArgs = ({ staged = false, from, to, file } = {}) => {
    const args = ['diff'];
    if (staged) args.push('--cached');
    if (from && to) args.push(`${from}..${to}`);
    else if (from) args.push(from);
    if (file) args.push('--', file);
    return args;
  };

  return Object.freeze({
    diff: async (options = {}) => gitClient.raw(buildArgs(options)),
    async numstat(options = {}) {
      const args = buildArgs(options);
      args.splice(1, 0, '--numstat');
      return parseNumstat(await gitClient.raw(args));
    },
  });
}
