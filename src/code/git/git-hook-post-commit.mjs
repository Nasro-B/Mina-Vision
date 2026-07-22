// Hook post-commit : après chaque commit réussi, la mémoire de Mina et le journal d'activité
// reçoivent l'événement. Fail-soft intégral — un souci de mémoire n'invalide jamais un commit.

export function createGitPostCommitHook({ memoryService = null, activityJournal = null } = {}) {
  return Object.freeze({
    async onCommit({ hash, message, files = [], project = null, branch = null } = {}) {
      if (typeof hash !== 'string' || hash.length === 0) throw new Error('git_post_commit_hash_required');
      if (typeof message !== 'string' || message.length === 0) throw new Error('git_post_commit_message_required');

      const [head, ...rest] = message.split(':');
      const entry = Object.freeze({
        timestamp: new Date().toISOString(),
        type: head?.replace(/\(.*\)$/u, '').trim() || 'chore',
        scope: head?.match(/\(([^)]+)\)/u)?.[1] ?? null,
        description: rest.join(':').trim(),
        hash: hash.slice(0, 7),
        files: Object.freeze([...files]),
        project,
        branch,
      });

      const outcomes = { memory: false, journal: false };
      if (memoryService && typeof memoryService.recordEvent === 'function') {
        try {
          await memoryService.recordEvent('git.commit', entry);
          outcomes.memory = true;
        } catch {
          // fail-soft
        }
      }
      if (activityJournal) {
        try {
          // API réelle du journal de Mina Vision : append(kind, payload).
          if (typeof activityJournal.append === 'function') {
            activityJournal.append('git.commit', entry);
            outcomes.journal = true;
          } else if (typeof activityJournal.log === 'function') {
            await activityJournal.log('commit', entry);
            outcomes.journal = true;
          }
        } catch {
          // fail-soft
        }
      }
      return Object.freeze({ entry, outcomes: Object.freeze(outcomes) });
    },
  });
}
