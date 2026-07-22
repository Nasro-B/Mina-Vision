import { PNG } from 'pngjs';

const KEY_ALIASES = Object.freeze({
  CTRL: 'LeftControl',
  CONTROL: 'LeftControl',
  SHIFT: 'LeftShift',
  ALT: 'LeftAlt',
  ENTER: 'Enter',
  RETURN: 'Return',
  ESC: 'Escape',
  ESCAPE: 'Escape',
  SPACE: 'Space',
  TAB: 'Tab',
  DELETE: 'Delete',
  BACKSPACE: 'Backspace',
  // Touche Windows + navigation : sans ces alias, « WIN » ou « UP » (casse du modèle) levait
  // « Touche interdite » — la route menu Démarrer (Win → taper le nom → Entrée) qui permet
  // d'ouvrir n'importe quelle application était donc morte, et les flèches avec elle.
  WIN: 'LeftSuper',
  WINDOWS: 'LeftSuper',
  SUPER: 'LeftSuper',
  META: 'LeftSuper',
  CMD: 'LeftSuper',
  UP: 'Up',
  DOWN: 'Down',
  LEFT: 'Left',
  RIGHT: 'Right',
  PAGEUP: 'PageUp',
  PAGEDOWN: 'PageDown',
  HOME: 'Home',
  END: 'End',
});

// Encodage par défaut de l'observation : PNG plein format (pngjs) — comportement historique.
// Le worker réel injecte un encodeur sharp (JPEG 1280) : mesuré 2026-07-22 sur 1920×1080,
// PNG sync coûtait 367 ms + 351 Ko par capture ; JPEG réduit = ~110 ms + 65 Ko (5×).
const defaultEncodeObservation = async ({ width, height, data }) => ({
  imageBase64: PNG.sync.write({ width, height, data }).toString('base64'),
  mimeType: 'image/png',
});

export function createDesktopDriver(nut, {
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  // Lanceur d'application Windows injecté par le worker (Start-Process sans shell). Absent
  // (contexte mobile/tests) → l'action launch_app échoue proprement au lieu de crasher.
  launchApp = null,
  encodeObservation = defaultEncodeObservation,
} = {}) {
  // Latence clavier/souris : nut-js sort d'usine avec autoDelayMs=300 PAR TOUCHE (taper
  // « Mina Vision » = 3,3 s) et 100 ms par opération souris — cause première de la lenteur
  // des missions bureau (constat 2026-07-22). 15/25 ms suffisent aux applications Windows.
  if (nut?.keyboard?.config) nut.keyboard.config.autoDelayMs = 15;
  if (nut?.mouse?.config) nut.mouse.config.autoDelayMs = 25;
  const point = (x, y) => new nut.Point(x, y);

  const position = async (action) => {
    await nut.mouse.setPosition(point(action.x, action.y));
  };

  const keyValue = (key) => {
    const normalized = String(key).toUpperCase();
    // Variantes X11/latérales émises par les modèles (« Super_L », « META_R », « Win_L »… —
    // cas réel journal 2026-07-22 : « Touche interdite: Super_L » tuait la mission bureau).
    const superVariant = normalized.match(/^(?:SUPER|META|WIN(?:DOWS)?|CMD)(?:_?(L|R))?$/u);
    if (superVariant) {
      const value = nut.Key[superVariant[1] === 'R' ? 'RightSuper' : 'LeftSuper'];
      if (value !== undefined) return value;
    }
    const enumName = KEY_ALIASES[normalized] || normalized;
    const value = nut.Key[enumName];
    if (value === undefined) throw new Error(`Touche interdite: ${key}`);
    return value;
  };

  const handlers = {
    click: async (action) => { await position(action); await nut.mouse.click(nut.Button.LEFT); },
    double_click: async (action) => { await position(action); await nut.mouse.doubleClick(nut.Button.LEFT); },
    triple_click: async (action) => {
      await position(action);
      await nut.mouse.doubleClick(nut.Button.LEFT);
      await nut.mouse.click(nut.Button.LEFT);
    },
    middle_click: async (action) => { await position(action); await nut.mouse.click(nut.Button.MIDDLE); },
    right_click: async (action) => { await position(action); await nut.mouse.rightClick(); },
    move: position,
    mouse_down: async (action) => { await position(action); await nut.mouse.pressButton(nut.Button.LEFT); },
    mouse_up: async (action) => { await position(action); await nut.mouse.releaseButton(nut.Button.LEFT); },
    drag: async (action) => {
      await position(action);
      await nut.mouse.pressButton(nut.Button.LEFT);
      try {
        await nut.mouse.setPosition(point(action.endX, action.endY));
      } finally {
        await nut.mouse.releaseButton(nut.Button.LEFT);
      }
    },
    scroll: async ({ scrollY = 0, scrollX = 0 }) => {
      if (scrollY > 0) await nut.mouse.scrollDown(Math.abs(scrollY));
      if (scrollY < 0) await nut.mouse.scrollUp(Math.abs(scrollY));
      if (scrollX > 0) await nut.mouse.scrollRight(Math.abs(scrollX));
      if (scrollX < 0) await nut.mouse.scrollLeft(Math.abs(scrollX));
    },
    type: async ({ text }) => nut.keyboard.type(text),
    key: async ({ keys = [] }) => {
      const values = keys.map(keyValue);
      await nut.keyboard.pressKey(...values);
      await nut.keyboard.releaseKey(...values.reverse());
    },
    key_down: async ({ keys = [] }) => nut.keyboard.pressKey(...keys.map(keyValue)),
    key_up: async ({ keys = [] }) => nut.keyboard.releaseKey(...keys.map(keyValue).reverse()),
    wait: async ({ milliseconds = 1_000 }) => sleep(Math.min(Math.max(milliseconds, 0), 5_000)),
    launch_app: async (action) => {
      // Seule la route Windows (action.app, validée par le normalizer) passe ici — un composant
      // Android n'a pas de sens sur le bureau.
      if (typeof action?.app !== 'string' || action.app.length === 0) {
        throw new Error('Application requise');
      }
      if (typeof launchApp !== 'function') {
        throw new Error("Lancement d'application indisponible sur ce worker");
      }
      await launchApp(action.app);
      // Laisser la fenêtre apparaître : l'orchestrateur reprend une capture juste après.
      await sleep(1_800);
    },
    // Same contract as the browser executor: « observe » from the model is a no-op — the
    // orchestrator takes its own screenshot after every action anyway. Rejecting it killed every
    // desktop mission at its first look-around (« Action worker interdite: observe »).
    observe: async () => {},
  };

  return Object.freeze({
    observe: async () => {
      const image = await nut.screen.grab();
      const rgb = await image.toRGB();
      const encoded = await encodeObservation({
        width: rgb.width,
        height: rgb.height,
        data: Buffer.from(rgb.data),
      });
      // width/height restent TOUJOURS les dimensions RÉELLES de l'écran : le mapping souris
      // (0-1000 → pixels) en dépend — seule l'IMAGE envoyée au modèle peut être réduite.
      return {
        ...encoded,
        width: rgb.width,
        height: rgb.height,
      };
    },
    execute: async (action) => {
      const handler = handlers[action?.name];
      if (!handler) throw new Error(`Action worker interdite: ${action?.name}`);
      await handler(action);
      return { executed: true };
    },
    releaseAllInputs: async () => {
      await nut.mouse.releaseButton(nut.Button.LEFT);
      await nut.mouse.releaseButton(nut.Button.RIGHT);
      await nut.mouse.releaseButton(nut.Button.MIDDLE);
      await nut.keyboard.releaseKey(
        nut.Key.LeftControl,
        nut.Key.RightControl,
        nut.Key.LeftShift,
        nut.Key.RightShift,
        nut.Key.LeftAlt,
        nut.Key.RightAlt,
        nut.Key.LeftSuper,
        nut.Key.RightSuper,
      );
      return { released: true };
    },
  });
}
