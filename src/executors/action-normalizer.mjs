const ALLOWED_ACTIONS = new Set([
  'click',
  'double_click',
  'triple_click',
  'middle_click',
  'right_click',
  'move',
  'mouse_down',
  'mouse_up',
  'drag',
  'scroll',
  'type',
  'key',
  'wait',
  'done',
  'drag_and_drop',
  'press_key',
  'hotkey',
  'key_down',
  'key_up',
  'navigate',
  'go_back',
  'go_forward',
  'take_screenshot',
  'launch_app',
]);

const INTERNAL_NAMES = Object.freeze({
  drag_and_drop: 'drag',
  press_key: 'key',
  hotkey: 'key',
  take_screenshot: 'observe',
});

const POINTER_ACTIONS = new Set([
  'click', 'double_click', 'triple_click', 'middle_click', 'right_click',
  'move', 'mouse_down', 'mouse_up',
]);

const FORBIDDEN_ARGUMENTS = new Set([
  'command',
  'cmd',
  'powershell',
  'shell',
  'script',
  'executable',
]);

const EXPECTED_EFFECT_TYPES = new Set([
  'ui_state_change',
  'file_appeared',
  'print_job_accepted',
  'message_accepted',
]);

function expectedEffect(value) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !EXPECTED_EFFECT_TYPES.has(value.type)
    || Object.keys(value).some((key) => !['type', 'path', 'digest'].includes(key))
    || (value.path !== undefined && (typeof value.path !== 'string' || value.path.length > 4_000))
    || (value.digest !== undefined && (typeof value.digest !== 'string' || value.digest.length > 256))) {
    throw new Error('Effet attendu invalide');
  }
  return Object.freeze({
    type: value.type,
    ...(value.path !== undefined ? { path: value.path } : {}),
    ...(value.digest !== undefined ? { digest: value.digest } : {}),
  });
}

const pixel = (value, size, field) => {
  if (!Number.isFinite(value) || value < 0 || value > 1_000) {
    throw new Error(`${field} hors limites`);
  }
  return Math.round((value / 1_000) * size);
};

export function normalizeAction(functionCall, viewport) {
  const name = functionCall?.name;
  const args = functionCall?.arguments ?? {};

  if (!ALLOWED_ACTIONS.has(name)) throw new Error(`Action interdite: ${name}`);
  if (!Number.isFinite(viewport?.width) || !Number.isFinite(viewport?.height)) {
    throw new Error('Viewport invalide');
  }

  for (const key of Object.keys(args)) {
    if (FORBIDDEN_ARGUMENTS.has(key.toLowerCase())) {
      throw new Error(`Argument interdit: ${key}`);
    }
  }

  const typingText = typeof args.text === 'string'
    ? args.text
    : typeof args.value === 'string'
      ? args.value
      : typeof args.content === 'string'
        ? args.content
        : undefined;

  if (typeof typingText === 'string' && typingText.length > 10_000) {
    throw new Error('Texte trop long');
  }
  if (name === 'type' && (!typingText || typeof typingText !== 'string')) {
    throw new Error('Texte de saisie requis');
  }

  const action = {
    name: INTERNAL_NAMES[name] || name,
    intent: typeof args.intent === 'string' ? args.intent : '',
    safetyDecision: args.safety_decision?.decision ?? args.safety_decision ?? null,
  };
  const effect = expectedEffect(args.expected_effect);
  if (effect) action.expectedEffect = effect;

  const sourceX = 'start_x' in args ? args.start_x : args.x;
  const sourceY = 'start_y' in args ? args.start_y : args.y;
  if (sourceX !== undefined) action.x = pixel(sourceX, viewport.width, 'x');
  if (sourceY !== undefined) action.y = pixel(sourceY, viewport.height, 'y');
  if ('end_x' in args) action.endX = pixel(args.end_x, viewport.width, 'end_x');
  if ('end_y' in args) action.endY = pixel(args.end_y, viewport.height, 'end_y');
  if ('scroll_x' in args) action.scrollX = Number(args.scroll_x);
  if ('scroll_y' in args) action.scrollY = Number(args.scroll_y);
  if (name === 'type') action.text = typingText;
  if (name === 'type' && args.replace_text === true) action.replaceText = true;
  if (Array.isArray(args.keys)) action.keys = [...args.keys];
  if (typeof args.key === 'string') action.keys = [args.key];
  if (typeof args.press_enter === 'boolean') action.pressEnter = args.press_enter;

  if (name === 'launch_app') {
    const packageName = args.package_name ?? args.packageName;
    const activityName = args.activity_name ?? args.activityName;
    const app = args.app ?? args.application;
    if (packageName !== undefined || activityName !== undefined || app === undefined) {
      // Route Android (mobile) : composant package/activity strict — comportement historique.
      const componentPart = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/u;
      if (!componentPart.test(packageName ?? '') || !componentPart.test(activityName ?? '')) {
        throw new Error('Composant Android invalide');
      }
      action.packageName = packageName;
      action.activityName = activityName;
    } else {
      // Route Windows (desktop) : NOM d'application uniquement — jamais un chemin, jamais des
      // arguments, aucun métacaractère shell (anti-injection avant même la politique).
      const appName = /^[A-Za-z0-9][A-Za-z0-9 ._+-]{1,63}$/u;
      if (typeof app !== 'string' || !appName.test(app) || app.includes('..')) {
        throw new Error('Application invalide');
      }
      action.app = app;
    }
  }

  if (name === 'wait') {
    const milliseconds = args.milliseconds ?? (args.seconds === undefined ? 1_000 : Number(args.seconds) * 1_000);
    if (!Number.isFinite(Number(milliseconds)) || Number(milliseconds) < 0 || Number(milliseconds) > 5_000) {
      throw new Error('Durée d’attente invalide');
    }
    action.milliseconds = Math.round(Number(milliseconds));
  }

  if (typeof args.direction === 'string') {
    const magnitude = Number(args.magnitude_in_pixels ?? 300);
    if (!Number.isFinite(magnitude) || magnitude < 0 || magnitude > 1_000) {
      throw new Error('Magnitude de scroll invalide');
    }
    const directions = {
      up: [0, -magnitude],
      down: [0, magnitude],
      left: [-magnitude, 0],
      right: [magnitude, 0],
    };
    const vector = directions[args.direction.toLowerCase()];
    if (!vector) throw new Error('Direction de scroll invalide');
    [action.scrollX, action.scrollY] = vector;
  }

  if (typeof args.url === 'string') {
    let url;
    try {
      url = new URL(args.url);
    } catch {
      throw new Error('URL interdite');
    }
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('URL interdite');
    action.url = url.href;
  }

  if (POINTER_ACTIONS.has(name) && (!Number.isFinite(action.x) || !Number.isFinite(action.y))) {
    throw new Error('Coordonnées x/y requises');
  }
  if (name === 'drag' && (![action.x, action.y, action.endX, action.endY].every(Number.isFinite))) {
    throw new Error('Coordonnées de déplacement requises');
  }
  if (['key', 'press_key', 'hotkey', 'key_down', 'key_up'].includes(name)
    && (!Array.isArray(action.keys) || action.keys.length < 1
      || action.keys.length > 8 || action.keys.some((key) => typeof key !== 'string' || !key.trim()))) {
    throw new Error('Touche requise');
  }
  if (name === 'scroll' && !Number.isFinite(action.scrollX) && !Number.isFinite(action.scrollY)) {
    throw new Error('Déplacement de scroll requis');
  }
  if (name === 'navigate' && !action.url) throw new Error('URL requise');

  return Object.freeze(action);
}
