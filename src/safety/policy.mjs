const CONFIRM_ACTIONS = new Set([
  'delete',
  'upload',
  'download',
  'print',
  'send_message',
  'purchase',
  'authenticate',
  'save_password',
  'change_permissions',
  'change_system',
  'run_downloaded_software',
]);

const BLOCKED_APPS = /1password|bitwarden|keepass|sécurité windows|windows security|defender|antivirus|terminal|powershell|command prompt|cmd\.exe/i;
const SENSITIVE_INTENT = /imprim|print|t[ée]l[ée]charg|download|envoy|send\b|achet|purchase|supprim|delete/iu;
const BLOCKED_CAPABILITIES = /^(system\.terminal|credentials\.|security\.windows|computer\.(terminal|password_manager))/i;

const isPrintHotkey = (action) => {
  if (action?.name !== 'key') return false;
  const keys = new Set((action.keys ?? []).map((key) => String(key).toUpperCase()));
  return (keys.has('CTRL') || keys.has('CONTROL')) && keys.has('P');
};

export function classifyAction(action, context = {}) {
  if (action?.safetyDecision === 'blocked') {
    return { decision: 'block', reason: 'Gemini a bloqué cette action.' };
  }

  if (BLOCKED_APPS.test(context.app ?? '')) {
    return { decision: 'block', reason: 'Application interdite.' };
  }

  // Lancement d'application Windows : mêmes interdits que le contexte au premier plan —
  // gestionnaires de mots de passe, terminaux et outils de sécurité ne se LANCENT pas non plus.
  if (action?.name === 'launch_app' && BLOCKED_APPS.test(action.app ?? '')) {
    return { decision: 'block', reason: 'Application interdite.' };
  }

  if (
    action?.safetyDecision === 'require_confirmation'
    || CONFIRM_ACTIONS.has(action?.name)
    || isPrintHotkey(action)
    || SENSITIVE_INTENT.test(action?.intent ?? '')
  ) {
    return { decision: 'confirm', reason: action?.intent || 'Action sensible.' };
  }

  return { decision: 'allow', reason: 'Action locale non sensible.' };
}

export function classifyCapabilityBase({ capability, effect, sensitivity }) {
  if (BLOCKED_CAPABILITIES.test(capability ?? '')) {
    return { decision: 'deny', reason: 'base_policy' };
  }
  if (!['read', 'write', 'execute', 'send'].includes(effect)) {
    return { decision: 'deny', reason: 'base_policy' };
  }
  if (String(capability).startsWith('conversation.')) {
    return { decision: 'allow', reason: 'base_policy' };
  }
  if (effect === 'read') return { decision: 'allow', reason: 'base_policy' };
  // Boucle Computer Use locale (R-01) : une action ORDINAIRE (classée non sensible par
  // classifyAction) est couverte par le grant de mission borné — la confirmation one-shot
  // reste exigée pour toute action sensible. Fail-closed : sensitivity absente = sensible.
  // Les capacités des autres domaines (mail.*, home.*, …) gardent la confirmation systématique.
  if (String(capability).startsWith('computer.') && effect === 'execute' && sensitivity === 'ordinary') {
    return { decision: 'allow', reason: 'base_policy' };
  }
  return { decision: 'confirm', reason: 'base_policy' };
}
