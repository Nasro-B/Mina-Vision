const STATUS_CMD = '/mail status';
const PAUSE_CMD = '/mail pause';
const RESUME_CMD = '/mail resume';
const MODE_CMD = /^\/mail mode ([1-3])$/u;
const SEARCH_CMD = /^\/mail search (.{1,200})$/u;
const MAX_SEGMENT_CHARS = 3_500;

function segments(text) {
  const value = String(text ?? '');
  const chunks = [];
  for (let index = 0; index < value.length; index += MAX_SEGMENT_CHARS) chunks.push(value.slice(index, index + MAX_SEGMENT_CHARS));
  return Object.freeze(chunks.length ? chunks : ['']);
}

export function createTelegramMailCommands({
  isOwner,
  mailAccountStore,
  mailSyncService,
  mailPolicies,
  searchMessages,
  audit,
  notifyPc,
} = {}) {
  if (typeof isOwner !== 'function' || !mailAccountStore?.listStatus || !mailSyncService?.pause || !mailSyncService?.resume
    || !mailPolicies || typeof mailPolicies !== 'object' || typeof audit !== 'function' || typeof notifyPc !== 'function') {
    throw new TypeError('telegram_mail_commands_dependencies_required');
  }

  async function handle({ sender, body } = {}) {
    if (typeof body !== 'string' || !body.trim().startsWith('/mail')) return null;
    if (!(await isOwner(sender))) {
      audit({ type: 'telegram_mail_command_denied_identity', sender });
      return Object.freeze({ reply: segments('Commande refusée.') });
    }
    const trimmed = body.trim();

    if (trimmed === STATUS_CMD) {
      const statuses = await mailAccountStore.listStatus();
      const text = statuses.length
        ? statuses.map((status) => `${status.accountId}: ${status.provider} mode ${status.mode}`).join('\n')
        : 'Aucun compte configuré.';
      return Object.freeze({ reply: segments(text) });
    }

    if (trimmed === PAUSE_CMD || trimmed === RESUME_CMD) {
      const statuses = await mailAccountStore.listStatus();
      const action = trimmed === PAUSE_CMD ? 'pause' : 'resume';
      await Promise.all(statuses.map((status) => mailSyncService[action](status.accountId)));
      audit({ type: `telegram_mail_${action}`, sender });
      return Object.freeze({ reply: segments(action === 'pause' ? 'Synchronisation e-mail en pause.' : 'Synchronisation e-mail reprise.') });
    }

    const modeMatch = trimmed.match(MODE_CMD);
    if (modeMatch) {
      const mode = Number(modeMatch[1]);
      for (const policy of Object.values(mailPolicies)) policy.setMode(mode);
      audit({ type: 'telegram_mail_mode_changed', sender, mode });
      await notifyPc({ type: 'mail_mode_changed', mode, sender });
      return Object.freeze({ reply: segments(`Mode e-mail réglé sur ${mode}.`) });
    }

    const searchMatch = trimmed.match(SEARCH_CMD);
    if (searchMatch) {
      if (typeof searchMessages !== 'function') return Object.freeze({ reply: segments('Recherche indisponible.') });
      const results = await searchMessages(searchMatch[1]);
      const text = results.length ? results.map((result) => `${result.subject} — ${result.from}`).join('\n') : 'Aucun résultat.';
      return Object.freeze({ reply: segments(text) });
    }

    return Object.freeze({ reply: segments('Commande /mail inconnue.') });
  }

  return Object.freeze({ handle });
}
