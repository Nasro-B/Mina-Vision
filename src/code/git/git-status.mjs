// Lecture d'état Git : parse « git status --porcelain=v2 --branch » en structure typée.

export function parsePorcelainV2(output) {
  const lines = String(output ?? '').split('\n');
  const status = {
    branch: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    staged: [],
    modified: [],
    untracked: [],
    conflicted: [],
  };
  for (const line of lines) {
    if (line.startsWith('# branch.head ')) status.branch = line.slice('# branch.head '.length).trim();
    else if (line.startsWith('# branch.upstream ')) status.upstream = line.slice('# branch.upstream '.length).trim();
    else if (line.startsWith('# branch.ab ')) {
      const match = line.match(/\+([0-9]+) -([0-9]+)/u);
      if (match) {
        status.ahead = Number(match[1]);
        status.behind = Number(match[2]);
      }
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
      const fields = line.split(' ');
      const xy = fields[1] ?? '..';
      const file = line.startsWith('2 ')
        ? line.split('\t')[0].split(' ').slice(9).join(' ')
        : fields.slice(8).join(' ');
      if (xy[0] !== '.') status.staged.push(file);
      if (xy[1] !== '.') status.modified.push(file);
    } else if (line.startsWith('u ')) {
      status.conflicted.push(line.split(' ').slice(10).join(' '));
    } else if (line.startsWith('? ')) {
      status.untracked.push(line.slice(2));
    }
  }
  return Object.freeze({
    ...status,
    staged: Object.freeze(status.staged),
    modified: Object.freeze(status.modified),
    untracked: Object.freeze(status.untracked),
    conflicted: Object.freeze(status.conflicted),
    clean: status.staged.length === 0 && status.modified.length === 0
      && status.untracked.length === 0 && status.conflicted.length === 0,
  });
}

export function createGitStatus({ gitClient } = {}) {
  if (!gitClient) throw new TypeError('git_status_client_required');
  return Object.freeze({
    async status() {
      const output = await gitClient.raw(['status', '--porcelain=v2', '--branch']);
      return parsePorcelainV2(output);
    },
  });
}
