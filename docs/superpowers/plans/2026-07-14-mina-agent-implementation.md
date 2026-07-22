# Mina Agent Implementation Plan

> **Note de vérification (2026-07-16) :** Ce plan reste avec 0 case cochée intentionnellement. `2026-07-14-mina-v3-master-plan.md` (Global Constraints, ligne 15) est explicite : « Ne jamais rejouer `2026-07-14-mina-agent-implementation.md` : il décrit le socle déjà présent et contient des chemins UI périmés. » Il s'agit du plan v1 original (architecture `src/core/mission-state.mjs`/`orchestrator.mjs`/`src/safety/policy.mjs`), remplacé par l'architecture en couches v2/v3/v4 (`CapabilityBroker`, sessions, grounding, etc.) utilisée partout ailleurs dans `docs/superpowers/plans/`. Conformément à cette contrainte, ce fichier n'a pas été exécuté ni ses cases cochées lors de la vérification exhaustive de tous les plans du 2026-07-16 — c'est une décision documentée, pas un oubli.

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Subagents are forbidden unless Nasro explicitly authorizes their number and roles first.

**Goal:** Build and launch Mina, an on-demand local visual agent with voice activation, Gemini Computer Use, Huawei phone camera access, safe Windows/browser control, and a tested Google Photos dental-sorting mission.

**Architecture:** An Electron shell hosts the visible UI and audio capture while an orchestrator runs in the main process. Gemini 3.5 Flash supplies Computer Use actions; Playwright handles browser actions, an isolated Node worker handles Windows input, and ADB plus `scrcpy` handle the phone. Pure state, safety, parsing, routing, and mission logic stay dependency-injected so they can be tested without moving the real mouse or contacting external APIs.

**Tech Stack:** Node.js 22.14+, Electron 43.1, ESM `.mjs`, Vitest 4.1, `@google/genai` 2.11, Playwright 1.61, OpenAI SDK 6.46 for OpenRouter, `@nut-tree-fork/nut-js` 4.2.6 in a system-Node worker, ADB, `scrcpy` 3.3.4, Gemini Live API.

## Global Constraints

- Application name: **Mina**.
- Wake phrases: `Salut Mina`, `Bonjour Mina`, `Mina, comment ça va ?`.
- Launch only through a user shortcut; never register Windows startup.
- `Ctrl+Alt+Échap` is the global emergency stop; `Mina, arrête` stops the active mission.
- Gemini Computer Use must use `gemini-3.5-flash` with prompt-injection detection enabled.
- No screenshot, webcam frame, microphone audio, password, or secret may be persisted by default.
- Always confirm deletions, uploads, downloads, messages, purchases, authentication, password operations, permission changes, system changes, and newly downloaded software execution.
- Block password managers, Windows Security/antivirus, terminal windows, and model-blocked actions.
- Stop after three consecutive failures, the configured action budget, or mission timeout.
- OpenRouter and Modal may classify dental images only; they never control the desktop in v1.
- The exposed Gemini, OpenRouter, and Modal credentials must be rotated before any live API test.
- Do not initialize Git, commit, push, or deploy without a separate explicit order from Nasro.
- Every behavioral change follows red → green TDD; the full suite runs before final launch.

## File Map

- `.gitignore`: excludes secrets, profiles, captures, logs, and Electron build output.
- `.env.example`: documents names only, never values.
- `package.json`: scripts and pinned dependencies.
- `vitest.config.mjs`: unit/integration test discovery.
- `src/config.mjs`: validated runtime configuration with redacted diagnostics.
- `src/core/mission-state.mjs`: mission state machine and budgets.
- `src/core/orchestrator.mjs`: coordinates goals, observations, safety, execution, and completion.
- `src/safety/policy.mjs`: local non-bypassable action classification.
- `src/providers/gemini-computer-use.mjs`: Gemini Interactions API adapter.
- `src/providers/gemini-live.mjs`: Gemini Live session and transcript/audio events.
- `src/providers/dental-vision.mjs`: Gemini → OpenRouter → Modal classification router.
- `src/executors/action-normalizer.mjs`: normalized coordinates and strict action schema.
- `src/executors/browser-executor.mjs`: Playwright browser actions and screenshots.
- `src/executors/desktop-client.mjs`: JSONL client for the isolated input worker.
- `src/executors/desktop-worker.mjs`: `nut-js` mouse/keyboard/screen implementation.
- `src/executors/phone-bridge.mjs`: ADB detection, phone screenshots/actions, and `scrcpy` lifecycle.
- `src/missions/dental-sort.mjs`: Google Photos traversal and selection logic.
- `src/ui/main.mjs`: Electron lifecycle, IPC, emergency shortcut, orchestration.
- `src/ui/preload.mjs`: narrow context-isolated renderer API.
- `src/ui/renderer/index.html`: Mina menu and status UI.
- `src/ui/renderer/app.mjs`: renderer state, microphone PCM, confirmations, audio playback.
- `src/ui/renderer/styles.css`: visible interface states.
- `scripts/start-mina.ps1`: safe foreground launcher.
- `scripts/install-shortcut.ps1`: one-time Desktop shortcut creation.
- `tests/**/*.test.mjs`: unit and integration tests mirroring the modules above.

---

### Task 1: Secure foundation, dependency migration, and test harness

**Files:**
- Create: `.gitignore`
- Create: `.env.example`
- Modify: `package.json`
- Create: `vitest.config.mjs`
- Create: `src/config.mjs`
- Create: `tests/config.test.mjs`

**Interfaces:**
- Produces: `loadConfig(env, overrides?) -> Readonly<Config>` and `redactConfig(config) -> object`.
- `Config` contains `geminiApiKey`, `openrouterApiKey`, `openrouterVisionModel`, `modalEndpoint`, `modalTokenId`, `modalTokenSecret`, `adbPath`, `scrcpyPath`, `maxActions`, `missionTimeoutMs`, and `dryRun`.

- [ ] **Step 1: Record the baseline test state without claiming success**

Run: `npm test`

Expected: exit code `1` with `Error: no test specified`. Record this as “baseline has no suite”, not as a passing baseline.

- [ ] **Step 2: Write failing configuration tests**

```js
import { describe, expect, it } from 'vitest';
import { loadConfig, redactConfig } from '../src/config.mjs';

describe('loadConfig', () => {
  it('fails closed without Gemini credentials', () => {
    expect(() => loadConfig({})).toThrow('GEMINI_API_KEY');
  });

  it('never exposes secret values in diagnostics', () => {
    const config = loadConfig({ GEMINI_API_KEY: 'gemini-secret', OPENROUTER_API_KEY: 'router-secret' });
    expect(JSON.stringify(redactConfig(config))).not.toMatch(/gemini-secret|router-secret/);
  });

  it('uses finite safety budgets', () => {
    const config = loadConfig({ GEMINI_API_KEY: 'x', MINA_MAX_ACTIONS: '25', MINA_TIMEOUT_MS: '600000' });
    expect(config.maxActions).toBe(25);
    expect(config.missionTimeoutMs).toBe(600000);
  });
});
```

- [ ] **Step 3: Run the test to verify red**

Run: `npx vitest run tests/config.test.mjs`

Expected: FAIL because `src/config.mjs` does not exist.

- [ ] **Step 4: Add the secure manifest and ignore rules**

Set scripts and dependencies explicitly:

```json
{
  "main": "src/ui/main.mjs",
  "scripts": {
    "start": "electron .",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:integration": "vitest run tests/integration",
    "smoke": "electron . --mina-smoke"
  },
  "dependencies": {
    "@google/genai": "2.11.0",
    "@nut-tree-fork/nut-js": "4.2.6",
    "dotenv": "17.4.2",
    "openai": "6.46.0",
    "playwright": "1.61.1"
  },
  "devDependencies": {
    "electron": "43.1.0",
    "vitest": "4.1.10"
  }
}
```

`.gitignore` must include:

```gitignore
.env
.env.*
!.env.example
node_modules/
artifacts/
captures/
logs/
profiles/
dist/
*.log
```

`.env.example` contains names only:

```dotenv
GEMINI_API_KEY=
OPENROUTER_API_KEY=
OPENROUTER_VISION_MODEL=
MODAL_ENDPOINT=
MODAL_TOKEN_ID=
MODAL_TOKEN_SECRET=
ADB_PATH=
SCRCPY_PATH=
MINA_MAX_ACTIONS=40
MINA_TIMEOUT_MS=900000
MINA_DRY_RUN=true
```

- [ ] **Step 5: Implement strict configuration**

```js
const required = (env, name) => {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Configuration manquante: ${name}`);
  return value;
};

const positiveInt = (value, fallback, name) => {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Configuration invalide: ${name}`);
  return parsed;
};

export function loadConfig(env = process.env, overrides = {}) {
  const config = {
    geminiApiKey: required(env, 'GEMINI_API_KEY'),
    openrouterApiKey: env.OPENROUTER_API_KEY?.trim() || null,
    openrouterVisionModel: env.OPENROUTER_VISION_MODEL?.trim() || null,
    modalEndpoint: env.MODAL_ENDPOINT?.trim() || null,
    modalTokenId: env.MODAL_TOKEN_ID?.trim() || null,
    modalTokenSecret: env.MODAL_TOKEN_SECRET?.trim() || null,
    adbPath: env.ADB_PATH?.trim() || 'adb',
    scrcpyPath: env.SCRCPY_PATH?.trim() || 'scrcpy',
    maxActions: positiveInt(env.MINA_MAX_ACTIONS, 40, 'MINA_MAX_ACTIONS'),
    missionTimeoutMs: positiveInt(env.MINA_TIMEOUT_MS, 900000, 'MINA_TIMEOUT_MS'),
    dryRun: (env.MINA_DRY_RUN ?? 'true').toLowerCase() !== 'false',
    ...overrides,
  };
  return Object.freeze(config);
}

export function redactConfig(config) {
  return {
    ...config,
    geminiApiKey: config.geminiApiKey ? '[configured]' : '[missing]',
    openrouterApiKey: config.openrouterApiKey ? '[configured]' : '[missing]',
    modalTokenId: config.modalTokenId ? '[configured]' : '[missing]',
    modalTokenSecret: config.modalTokenSecret ? '[configured]' : '[missing]',
  };
}
```

- [ ] **Step 6: Install and verify green**

Run: `npm install`

Run: `npm test -- --run tests/config.test.mjs`

Expected: 3 tests PASS; `.env` remains unchanged and unprinted.

---

### Task 2: Mission state machine and non-bypassable safety policy

**Files:**
- Create: `src/core/mission-state.mjs`
- Create: `src/safety/policy.mjs`
- Create: `tests/mission-state.test.mjs`
- Create: `tests/safety-policy.test.mjs`

**Interfaces:**
- Produces: `createMission({ goal, mode, maxActions, timeoutMs, now })`.
- Produces: `recordAction(state, now)`, `recordFailure(state, reason)`, `completeMission(state, result)`, `stopMission(state, reason)`.
- Produces: `classifyAction(action, context) -> { decision: 'allow'|'confirm'|'block', reason }`.

- [ ] **Step 1: Write failing state and policy tests**

```js
it('stops on the third consecutive failure', () => {
  let state = createMission({ goal: 'test', mode: 'general', maxActions: 40, timeoutMs: 1000, now: 0 });
  state = recordFailure(recordFailure(recordFailure(state, 'x'), 'x'), 'x');
  expect(state.status).toBe('stopped');
});

it.each(['delete', 'upload', 'download', 'send_message', 'purchase', 'authenticate', 'change_system'])('%s requires confirmation', (name) => {
  expect(classifyAction({ name, arguments: {} }, { app: 'Chrome' }).decision).toBe('confirm');
});

it.each(['1Password', 'Sécurité Windows', 'Windows Terminal'])('blocks %s', (app) => {
  expect(classifyAction({ name: 'click', arguments: {} }, { app }).decision).toBe('block');
});
```

- [ ] **Step 2: Verify red**

Run: `npx vitest run tests/mission-state.test.mjs tests/safety-policy.test.mjs`

Expected: FAIL because both modules are missing.

- [ ] **Step 3: Implement immutable transitions and local policy**

Use explicit constants:

```js
const CONFIRM = new Set(['delete', 'upload', 'download', 'send_message', 'purchase', 'authenticate', 'save_password', 'change_permissions', 'change_system', 'run_downloaded_software']);
const BLOCKED_APPS = /1password|bitwarden|keepass|sécurité windows|windows security|defender|antivirus|terminal|powershell|command prompt|cmd\.exe/i;

export function classifyAction(action, context = {}) {
  if (action?.safetyDecision === 'blocked') return { decision: 'block', reason: 'Gemini a bloqué cette action.' };
  if (BLOCKED_APPS.test(context.app ?? '')) return { decision: 'block', reason: 'Application interdite.' };
  if (action?.safetyDecision === 'require_confirmation' || CONFIRM.has(action?.name)) {
    return { decision: 'confirm', reason: action.intent || 'Action sensible.' };
  }
  return { decision: 'allow', reason: 'Action locale non sensible.' };
}
```

State transitions must reject unknown statuses, stop at `failureCount >= 3`, stop at `actionCount >= maxActions`, and stop when `now - startedAt >= timeoutMs`.

- [ ] **Step 4: Verify green and regression**

Run: `npm test`

Expected: all tests PASS.

---

### Task 3: Strict Computer Use action normalization

**Files:**
- Create: `src/executors/action-normalizer.mjs`
- Create: `tests/action-normalizer.test.mjs`

**Interfaces:**
- Produces: `normalizeAction(functionCall, viewport) -> Action`.
- `Action = { name, x?, y?, text?, scrollX?, scrollY?, keys?, intent, safetyDecision }`.

- [ ] **Step 1: Write failing parser tests**

```js
it('denormalizes Gemini coordinates', () => {
  const action = normalizeAction({ name: 'click', arguments: { x: 500, y: 250, intent: 'focus' } }, { width: 1920, height: 1080 });
  expect(action).toMatchObject({ name: 'click', x: 960, y: 270, intent: 'focus' });
});

it('rejects unknown actions and out-of-range coordinates', () => {
  expect(() => normalizeAction({ name: 'shell', arguments: {} }, { width: 100, height: 100 })).toThrow();
  expect(() => normalizeAction({ name: 'click', arguments: { x: 1001, y: 0 } }, { width: 100, height: 100 })).toThrow();
});
```

- [ ] **Step 2: Verify red**

Run: `npx vitest run tests/action-normalizer.test.mjs`

Expected: FAIL because the module is missing.

- [ ] **Step 3: Implement the allowlisted schema**

Allow only `click`, `double_click`, `right_click`, `move`, `mouse_down`, `mouse_up`, `drag`, `scroll`, `type`, `key`, `wait`, and `done`. Convert 0–1000 coordinates with `Math.round(value / 1000 * dimension)`. Reject non-finite values, unknown keys, text over 10,000 characters, and any action containing command-shell fields.

```js
const ALLOWED = new Set(['click','double_click','right_click','move','mouse_down','mouse_up','drag','scroll','type','key','wait','done']);
const pixel = (value, size, field) => {
  if (!Number.isFinite(value) || value < 0 || value > 1000) throw new Error(`${field} hors limites`);
  return Math.round(value / 1000 * size);
};
```

- [ ] **Step 4: Verify green**

Run: `npm test`

Expected: all tests PASS.

---

### Task 4: Windows desktop executor isolated from Electron

**Files:**
- Create: `src/executors/desktop-worker.mjs`
- Create: `src/executors/desktop-client.mjs`
- Create: `tests/desktop-client.test.mjs`

**Interfaces:**
- Produces: `createDesktopClient({ spawnWorker, onEvent })` with `observe()`, `execute(action)`, `emergencyStop()`, and `close()`.
- Worker protocol: one JSON object per line; requests `{ id, method, params }`, responses `{ id, ok, result? , error? }`.

- [ ] **Step 1: Write a failing protocol test with a fake worker**

```js
it('correlates worker responses and redacts errors', async () => {
  const worker = createFakeWorker();
  const client = createDesktopClient({ spawnWorker: () => worker });
  const pending = client.execute({ name: 'click', x: 10, y: 20 });
  worker.reply({ id: worker.lastRequest.id, ok: true, result: { executed: true } });
  await expect(pending).resolves.toEqual({ executed: true });
});
```

- [ ] **Step 2: Verify red**

Run: `npx vitest run tests/desktop-client.test.mjs`

Expected: FAIL because the client is missing.

- [ ] **Step 3: Implement the worker client with a hard timeout**

Each request uses a random UUID, a 10-second timeout, bounded line length, and rejects malformed JSON. `emergencyStop()` aborts pending requests before sending `release_all_inputs`.

- [ ] **Step 4: Implement the system-Node worker**

Load `@nut-tree-fork/nut-js` only inside `desktop-worker.mjs`. Map allowlisted actions to mouse/keyboard APIs; `observe` returns an in-memory PNG base64 plus exact width/height; never accept file paths or shell commands from the model.

```js
const handlers = {
  click: async ({ x, y }) => { await mouse.setPosition(new Point(x, y)); await mouse.click(Button.LEFT); },
  double_click: async ({ x, y }) => { await mouse.setPosition(new Point(x, y)); await mouse.doubleClick(Button.LEFT); },
  move: async ({ x, y }) => mouse.setPosition(new Point(x, y)),
  scroll: async ({ scrollY = 0 }) => scrollY >= 0 ? mouse.scrollDown(Math.abs(scrollY)) : mouse.scrollUp(Math.abs(scrollY)),
  type: async ({ text }) => keyboard.type(text),
  release_all_inputs: async () => {
    await mouse.releaseButton(Button.LEFT);
    await mouse.releaseButton(Button.RIGHT);
    await mouse.releaseButton(Button.MIDDLE);
    await keyboard.releaseKey(
      Key.LeftControl, Key.RightControl,
      Key.LeftShift, Key.RightShift,
      Key.LeftAlt, Key.RightAlt,
      Key.LeftSuper, Key.RightSuper,
    );
  },
};
```

- [ ] **Step 5: Verify tests and perform a non-input smoke observation**

Run: `npm test`

Run worker method `observe` only; verify a PNG buffer and dimensions are returned. Do not move the real mouse yet.

Expected: all tests PASS; observation succeeds without a persisted screenshot.

---

### Task 5: Browser executor and Gemini Computer Use adapter

**Files:**
- Create: `src/executors/browser-executor.mjs`
- Create: `src/providers/gemini-computer-use.mjs`
- Create: `tests/browser-executor.test.mjs`
- Create: `tests/gemini-computer-use.test.mjs`
- Create: `tests/fixtures/control-page.html`

**Interfaces:**
- Produces: `createBrowserExecutor({ chromium, profileDir })` with `observe()`, `execute(action)`, `currentContext()`, `close()`.
- Produces: `createComputerUseClient({ apiKey, model, transport })` with `start({ goal, environment, screenshot })` and `continue({ interactionId, actionResult, screenshot })`.

- [ ] **Step 1: Write failing adapter tests**

```js
it('always enables prompt injection detection', async () => {
  const transport = vi.fn().mockResolvedValue({ id: 'i1', steps: [] });
  const client = createComputerUseClient({ apiKey: 'x', model: 'gemini-3.5-flash', transport });
  await client.start({ goal: 'click test', environment: 'browser', screenshot: 'data:image/png;base64,AA==' });
  expect(transport).toHaveBeenCalledWith(expect.objectContaining({
    model: 'gemini-3.5-flash',
    tools: [{ type: 'computer_use', environment: 'browser', enable_prompt_injection_detection: true }],
  }));
});
```

- [ ] **Step 2: Verify red**

Run: `npx vitest run tests/browser-executor.test.mjs tests/gemini-computer-use.test.mjs`

Expected: FAIL because modules are missing.

- [ ] **Step 3: Implement the Gemini adapter**

Use `GoogleGenAI` from `@google/genai`, but inject the transport in tests. Return only structured `function_call`, `model_output`, completion text, interaction id, and safety decision. Treat an empty/unknown response as an error, never as completion.

- [ ] **Step 4: Implement the Playwright executor**

Launch visible Chromium with `profiles/mina-chrome`, fixed viewport `1440x900`, and no remote-debugging attachment to the user’s normal Chrome. Implement screenshot in memory and map the normalized action object to Playwright calls.

- [ ] **Step 5: Verify with a controlled local page**

The fixture contains a button, text input, scrollable panel, and selected-text target. Run the integration test to click, type, scroll, and select without any network or personal account.

Run: `npm run test:integration -- tests/integration/browser-control.test.mjs`

Expected: PASS; no action leaves the fixture page.

---

### Task 6: Huawei phone camera and mobile control bridge

**Files:**
- Create: `src/executors/phone-bridge.mjs`
- Create: `tests/phone-bridge.test.mjs`

**Interfaces:**
- Produces: `createPhoneBridge({ run, adbPath, scrcpyPath })` with `detect()`, `startCamera()`, `observe()`, `execute(action)`, `startPreview()`, `stopPreview()`.

- [ ] **Step 1: Write failing ADB parsing and command tests**

```js
it('accepts exactly one authorized device', async () => {
  const bridge = createPhoneBridge({ run: fakeRun(['List of devices attached\nSERIAL device model:MAR_LX1A\n']) });
  await expect(bridge.detect()).resolves.toMatchObject({ serial: 'SERIAL', model: 'MAR_LX1A' });
});

it('rejects unauthorized or multiple devices', async () => {
  const bridge = createPhoneBridge({ run: fakeRun(['List of devices attached\nA unauthorized\nB device\n']) });
  await expect(bridge.detect()).rejects.toThrow();
});
```

- [ ] **Step 2: Verify red**

Run: `npx vitest run tests/phone-bridge.test.mjs`

Expected: FAIL because the bridge is missing.

- [ ] **Step 3: Implement safe process invocation**

Use `spawnFile`/`execFile` argument arrays only. Validate serial with `/^[A-Za-z0-9._:-]+$/`. Never concatenate goals, model text, paths, or device ids into a command string.

Commands are fixed:

```js
['devices', '-l']
['-s', serial, 'shell', 'am', 'start', '-a', 'android.media.action.STILL_IMAGE_CAMERA']
['-s', serial, 'exec-out', 'screencap', '-p']
['-s', serial, 'shell', 'input', 'tap', String(x), String(y)]
['-s', serial, 'shell', 'input', 'swipe', String(x1), String(y1), String(x2), String(y2), String(durationMs)]
```

Start `scrcpy` with fixed arguments `--serial`, serial, `--no-audio`, `--window-title`, `Mina — caméra téléphone`; allow one automatic restart only.

- [ ] **Step 4: Verify with the connected phone without taking a photo**

Run unit tests, then `detect`, `startCamera`, `startPreview`, and `observe`. Verify the returned PNG is non-empty and the preview is visible. Do not press the shutter.

Expected: Huawei `MAR_LX1A` detected; preview visible; no media created.

---

### Task 7: Mina voice activation and Gemini Live session

**Files:**
- Create: `src/providers/gemini-live.mjs`
- Create: `src/voice/wake-phrases.mjs`
- Create: `tests/wake-phrases.test.mjs`
- Create: `tests/gemini-live.test.mjs`

**Interfaces:**
- Produces: `detectWakePhrase(transcript) -> { activated, phrase, remainder }`.
- Produces: `createGeminiLiveSession({ apiKey, transport, onTranscript, onAudio, onError })` with `connect()`, `sendPcm16(buffer)`, `sendText(text)`, `close()`.

- [ ] **Step 1: Write failing wake phrase tests**

```js
it.each([
  ['Salut Mina, ouvre Chrome', 'ouvre Chrome'],
  ['Bonjour Mina', ''],
  ['Mina comment ça va ?', ''],
])('activates on %s', (input, remainder) => {
  expect(detectWakePhrase(input)).toMatchObject({ activated: true, remainder });
});

it.each(['minable', 'salut Nina', 'bonjour à tous'])('rejects false positive %s', (input) => {
  expect(detectWakePhrase(input).activated).toBe(false);
});
```

- [ ] **Step 2: Verify red**

Run: `npx vitest run tests/wake-phrases.test.mjs tests/gemini-live.test.mjs`

Expected: FAIL because modules are missing.

- [ ] **Step 3: Implement deterministic phrase detection**

Normalize Unicode accents, punctuation, repeated whitespace, and case. Match only the beginning of the transcript and explicit phrase boundaries; plain `Mina` alone does not activate v1.

- [ ] **Step 4: Implement the Live adapter behind an injected transport**

Configure French audio input, native audio output, and transcript events. Audio input is PCM16 little-endian at 16 kHz; output is PCM16 at 24 kHz. Do not write chunks to disk or include them in logs.

- [ ] **Step 5: Verify green with a fake WebSocket transcript/audio stream**

Run: `npm test`

Expected: all tests PASS; no network used.

---

### Task 8: Dental vision router with strict fallbacks

**Files:**
- Create: `src/providers/dental-vision.mjs`
- Create: `tests/dental-vision.test.mjs`
- Modify later, not yet delete: `agent_vision_sourire.js`

**Interfaces:**
- Produces: `parseDentalDecision(text) -> true|false`.
- Produces: `createDentalVision({ gemini, openrouter, modal, prompt })` with `classify(image) -> { match, provider, rawDecision }`.

- [ ] **Step 1: Write failing strict-routing tests**

```js
it.each([['OUI', true], [' oui. ', true], ['NON', false], ['non\n', false]])('parses %s', (text, expected) => {
  expect(parseDentalDecision(text)).toBe(expected);
});

it.each(['peut-être', '', 'OUI et NON'])('rejects ambiguous output %s', (text) => {
  expect(() => parseDentalDecision(text)).toThrow();
});

it('falls back only when a provider errors', async () => {
  const vision = createDentalVision({ gemini: failingProvider(), openrouter: fixedProvider('NON'), modal: fixedProvider('OUI'), prompt: 'x' });
  await expect(vision.classify(imageFixture())).resolves.toMatchObject({ match: false, provider: 'openrouter' });
  expect(vision.providers.modal.calls).toBe(0);
});
```

- [ ] **Step 2: Verify red**

Run: `npx vitest run tests/dental-vision.test.mjs`

Expected: FAIL because the router is missing.

- [ ] **Step 3: Implement provider adapters and routing**

Gemini uses the current dental prompt with inline image bytes. OpenRouter uses one configured `OPENROUTER_VISION_MODEL`, not a stale hardcoded free-model list. Modal is enabled only when endpoint and authentication configuration validate together. Provider errors are redacted; a valid `NON` is final and never triggers another provider.

- [ ] **Step 4: Verify green with local image fixtures**

Run: `npm test`

Expected: all tests PASS; no live API calls.

---

### Task 9: Google Photos dental-sorting mission, dry-run first

**Files:**
- Create: `src/missions/dental-sort.mjs`
- Create: `tests/dental-sort.test.mjs`
- Create: `tests/fixtures/google-photos-grid.html`
- Modify: `agent_vision_sourire.js` only after parity tests exist; convert it to a thin compatibility launcher or leave it untouched until cutover.

**Interfaces:**
- Produces: `runDentalSort({ page, vision, confirm, searchUrl, maxItems, dryRun, onProgress }) -> DentalSortReport`.
- `DentalSortReport = { analyzed, selected, rejected, errors, downloaded, stoppedReason }`.

- [ ] **Step 1: Write failing mission tests against a synthetic grid**

Test exact behavior: skip section index `0`, deduplicate resized URLs, classify each new asset once, select only matches, stop after no-new-content threshold, and never download when `dryRun` is true.

```js
expect(report).toEqual({ analyzed: 3, selected: 1, rejected: 2, errors: 0, downloaded: false, stoppedReason: 'end_of_results' });
expect(confirm).not.toHaveBeenCalled();
```

- [ ] **Step 2: Verify red**

Run: `npx vitest run tests/dental-sort.test.mjs`

Expected: FAIL because the mission is missing.

- [ ] **Step 3: Extract minimal mission logic from the current script**

Preserve the existing dental criteria and thumbnail URL normalization. Replace hardcoded download path and Shift+D side effect with an injected `confirm({ kind: 'download', count })`; only execute download on an explicit `true` response and `dryRun === false`.

- [ ] **Step 4: Verify the synthetic grid and full suite**

Run: `npm test`

Expected: all tests PASS.

- [ ] **Step 5: Perform a supervised live dry-run**

Open the dedicated Mina Chrome profile. Nasro authenticates manually if needed. Analyze at most 10 thumbnails with `MINA_DRY_RUN=true`. In dry-run mode the mission must not click any checkbox and must not invoke the confirmation callback.

Expected: report displayed; no download; no modifications outside the dedicated profile.

---

### Task 10: Orchestrator integration and confirmation handshake

**Files:**
- Create: `src/core/orchestrator.mjs`
- Create: `tests/orchestrator.test.mjs`

**Interfaces:**
- Produces: `createOrchestrator({ observer, computerUse, executor, safety, confirmer, clock, limits })` with `run(goal, mode)`, `confirm(id, decision)`, `stop(reason)`.

- [ ] **Step 1: Write failing end-to-end unit tests with fakes**

```js
it('executes an allowed action and verifies the next frame', async () => {
  const rig = createRig([clickAction(), doneAction()]);
  await expect(rig.orchestrator.run('clique le bouton test', 'general')).resolves.toMatchObject({ status: 'completed' });
  expect(rig.executor.execute).toHaveBeenCalledTimes(1);
  expect(rig.observer.observe).toHaveBeenCalledTimes(2);
});

it('does not execute a sensitive action before confirmation', async () => {
  const rig = createRig([downloadAction()]);
  const run = rig.orchestrator.run('télécharge', 'general');
  await rig.waitForConfirmation();
  expect(rig.executor.execute).not.toHaveBeenCalled();
  rig.orchestrator.confirm(rig.confirmationId, false);
  await expect(run).resolves.toMatchObject({ status: 'stopped' });
});
```

- [ ] **Step 2: Verify red**

Run: `npx vitest run tests/orchestrator.test.mjs`

Expected: FAIL because the orchestrator is missing.

- [ ] **Step 3: Implement the bounded observe-decide-authorize-act loop**

Execute one atomic action per iteration. Refresh observation after every action. A confirmation id is single-use and expires with the mission. Reject late confirmations, stale screenshots, unknown action names, and concurrent missions. `stop()` aborts provider calls, releases input, closes pending confirmation, and transitions to `stopped`.

- [ ] **Step 4: Verify green and regression**

Run: `npm test`

Expected: all tests PASS.

---

### Task 11: Electron UI, microphone, emergency stop, and visible status

**Files:**
- Create: `src/ui/main.mjs`
- Create: `src/ui/preload.mjs`
- Create: `src/ui/renderer/index.html`
- Create: `src/ui/renderer/app.mjs`
- Create: `src/ui/renderer/styles.css`
- Create: `tests/ui-contract.test.mjs`

**Interfaces:**
- Renderer API: `window.mina.start(mode, goal?)`, `stop()`, `confirm(id, decision)`, `sendAudio(arrayBuffer)`, `onState(callback)`, `onAudio(callback)`.
- No raw `ipcRenderer`, filesystem, shell, environment, or Node API is exposed to the renderer.

- [ ] **Step 1: Write failing preload contract tests**

Assert the exposed API contains only the seven allowlisted methods, validates mode as `general|dental`, limits goal length, and copies audio buffers instead of exposing Node buffers.

- [ ] **Step 2: Verify red**

Run: `npx vitest run tests/ui-contract.test.mjs`

Expected: FAIL because UI modules are missing.

- [ ] **Step 3: Implement a hardened Electron window**

Use `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, a restrictive Content Security Policy, no navigation, no popups, and no remote content. Register `CommandOrControl+Alt+Escape`; if registration fails, show a blocking error and do not enable automation.

- [ ] **Step 4: Implement the visible Mina interface**

The interface shows three primary buttons: `Agent général`, `Tri Google Photos`, `Arrêter`; states `inactive`, `listening`, `thinking`, `acting`, `confirmation`, `completed`, `error`; a bounded text log; a confirmation dialog; and camera availability. Labels use **Mina** everywhere.

- [ ] **Step 5: Implement microphone and output audio in memory**

Use `getUserMedia({ audio: true })`, `AudioWorklet` or an equivalent deterministic converter to 16-bit little-endian PCM at 16 kHz, and send bounded chunks through preload. Play Gemini output at 24 kHz. Stop and release every MediaStreamTrack when Mina closes or listening is disabled.

- [ ] **Step 6: Verify tests and smoke launch**

Run: `npm test`

Run: `npm run smoke`

Expected: window opens, shows Mina, then exits automatically in smoke mode; no mouse movement and no network call.

---

### Task 12: Safe launcher, Desktop shortcut, final verification, and launch

**Files:**
- Create: `scripts/start-mina.ps1`
- Create: `scripts/install-shortcut.ps1`
- Create: `tests/launcher-contract.test.mjs`
- Update: `README.md` if created during implementation, otherwise create it with exact operation and safety instructions.

**Interfaces:**
- Launcher exits non-zero when Node, dependencies, configuration, ADB, or `scrcpy` prerequisites fail.
- Shortcut points only to `scripts/start-mina.ps1`; it does not use startup folders or scheduled tasks.

- [ ] **Step 1: Write failing launcher contract tests**

Check that scripts contain no embedded secret, no `-ExecutionPolicy Bypass`, no download/install command, no startup-folder path, and that the shortcut target resolves inside `Mina Vision`.

- [ ] **Step 2: Verify red**

Run: `npx vitest run tests/launcher-contract.test.mjs`

Expected: FAIL because launcher scripts are missing.

- [ ] **Step 3: Implement foreground launcher**

`start-mina.ps1` resolves its own directory, changes to the project root, validates `node`, `npm`, `adb`, and `scrcpy`, validates that `.env` exists without printing it, then runs `npm start`. It propagates the exit code and never hides the window.

- [ ] **Step 4: Implement one-time shortcut creation**

Use `WScript.Shell.CreateShortcut` to create `Mina.lnk` on the current user Desktop. Set `TargetPath` to `powershell.exe`, arguments to `-NoProfile -File "<absolute project>\scripts\start-mina.ps1"`, working directory to the project, and description to `Lancer Mina`. Do not write into Startup.

- [ ] **Step 5: Require credential rotation before live tests**

Stop and ask Nasro to rotate the previously exposed Gemini, OpenRouter, and Modal credentials and replace the local `.env` values. Verify only presence and provider authentication result; never display, log, diff, or transmit the values anywhere except their intended provider requests.

- [ ] **Step 6: Run the complete verification matrix**

Run in order:

```powershell
npm test
npm run test:integration
npm run smoke
```

Expected: all suites PASS and smoke exits cleanly.

Then verify manually, in this order:

1. launch Mina from the Desktop shortcut;
2. confirm Huawei camera preview appears without recording;
3. say each wake phrase and verify exactly one activation;
4. run a local non-sensitive fixture mission involving click, scroll, type, and selection;
5. trigger a fake download and verify Mina blocks for confirmation;
6. press `Ctrl+Alt+Échap` during a harmless action and verify immediate stop/input release;
7. run Google Photos with `MINA_DRY_RUN=true`, maximum 10 thumbnails, no download;
8. close Mina and verify mic tracks, `scrcpy`, browser, worker, and provider sessions terminate.

- [ ] **Step 7: Launch Mina for normal on-demand use**

Only after every automated and manual check above passes, start Mina from `Mina.lnk` and leave the visible window in `inactive` state awaiting `Salut Mina`, `Bonjour Mina`, or `Mina, comment ça va ?`.

## Final Self-Review Checklist

- Every design requirement maps to a task above.
- No task requires a subagent, Git initialization, commit, push, deployment, credential display, or automatic Windows startup.
- All model-controlled actions pass through strict normalization and local safety before execution.
- Desktop, browser, phone, voice, and dental mission implementations have fake-driven tests before live use.
- Live API use is blocked until credential rotation.
- The final launch remains foreground, visible, bounded, interruptible, and on demand.
