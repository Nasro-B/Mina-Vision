const ALLOWED_ACTIONS = new Set([
  'sync', 'list', 'search', 'read', 'create_draft', 'update_draft', 'send', 'reply', 'forward',
  'move', 'label', 'archive', 'mark_read', 'mark_spam', 'trash', 'unsubscribe', 'undo',
]);
const MUTATIONS = new Set([
  'send', 'reply', 'forward', 'move', 'label', 'archive', 'mark_read', 'mark_spam', 'trash', 'unsubscribe', 'undo',
]);
const RANK = Object.freeze({ global: 0, account: 1, domain: 2, contact: 3, thread: 4 });

export function createMailPolicy({ defaultMode = 3, rules = [] } = {}) {
  if (![1, 2, 3].includes(defaultMode) || !Array.isArray(rules)) throw new TypeError('mail_policy_invalid');
  let currentDefaultMode = defaultMode;
  const normalized = rules.map((rule) => {
    if (!RANK.hasOwnProperty(rule?.scope) || typeof rule.match !== 'string' || ![1, 2, 3].includes(rule.mode)) {
      throw new TypeError('mail_rule_invalid');
    }
    return Object.freeze({ scope: rule.scope, match: rule.match.toLocaleLowerCase('en-US'), mode: rule.mode });
  });

  const modeFor = ({ accountId, contact, domain, threadId } = {}) => {
    const values = { account: accountId, contact, domain, thread: threadId, global: '*' };
    const matches = normalized.filter((rule) => String(values[rule.scope] ?? '').toLocaleLowerCase('en-US') === rule.match);
    if (!matches.length) return currentDefaultMode;
    const specificity = Math.max(...matches.map((rule) => RANK[rule.scope]));
    return Math.min(...matches.filter((rule) => RANK[rule.scope] === specificity).map((rule) => rule.mode));
  };

  function decide(request = {}) {
    if (request.requestedBy === 'inbound_email') return Object.freeze({ decision: 'deny', reason: 'mail_is_untrusted_input' });
    if (!ALLOWED_ACTIONS.has(request.action)) return Object.freeze({ decision: 'deny', reason: 'mail_action_forbidden' });
    const activeMode = modeFor(request);
    if (!MUTATIONS.has(request.action)) return Object.freeze({ decision: 'allow', mode: activeMode });
    if (activeMode === 1 && request.confirmedLocally !== true) return Object.freeze({ decision: 'confirm', mode: activeMode });
    if (activeMode === 2 && request.ruleAuthorized !== true && request.confirmedLocally !== true) {
      return Object.freeze({ decision: 'confirm', mode: activeMode });
    }
    return Object.freeze({ decision: 'allow', mode: activeMode });
  }

  function setMode(mode) {
    if (![1, 2, 3].includes(mode)) throw new TypeError('mail_policy_mode_invalid');
    currentDefaultMode = mode;
  }

  return Object.freeze({ mode: () => currentDefaultMode, modeFor, decide, setMode });
}
