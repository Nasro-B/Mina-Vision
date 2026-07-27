import assert from 'node:assert/strict';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';

const root = resolve('.');
const cloneRoot = join(root, 'node_modules', '.cache', 'mina-e2e-multi-2beded1');
const emergencyFiles = [
  'device-guard.mjs',
  'emergency-corpus.mjs',
  'emergency-mode.mjs',
  'network-policy.mjs',
];
for (const file of emergencyFiles) {
  await access(join(cloneRoot, 'src', 'emergency', file));
}
const runtime = await mkdtemp(join(cloneRoot, '.audit-runtime-run-'));
assert.equal(resolve(runtime).startsWith(`${resolve(cloneRoot)}\\`), true);

const pageErrors = [];
let application;
try {
  application = await electron.launch({
    args: [cloneRoot],
    cwd: cloneRoot,
    env: {
      ...process.env,
      MINA_AUDIT_ALLOW_MULTI_INSTANCE: 'true',
      MINA_AUDIT_USER_DATA: runtime,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    },
    timeout: 120_000,
  });
  const page = await application.firstWindow();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.locator('#welcome-overlay').waitFor({ state: 'visible', timeout: 120_000 });
  await page.locator('#welcome-start').click();
  await page.locator('#welcome-name').fill('Audit E2E');
  await page.locator('#welcome-save').click();
  await page.locator('#welcome-mem-init').waitFor({ state: 'visible', timeout: 30_000 });
  await page.locator('#welcome-mem-init').click();
  await page.locator('#welcome-phrase').waitFor({ state: 'visible', timeout: 120_000 });

  const phraseText = await page.locator('#welcome-phrase').textContent();
  const phrase = phraseText.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).at(-1);
  const phraseWordCount = phrase.split(/\s+/u).filter(Boolean).length;
  assert.equal(phraseWordCount, 12);
  await page.locator('#welcome-finish').click();
  await page.locator('#welcome-overlay').waitFor({ state: 'hidden', timeout: 30_000 });

  const views = ['mission', 'config', 'automation', 'today', 'diagnostic', 'code'];
  const activatedViews = [];
  for (const view of views) {
    await page.locator(`button.rail-btn[data-view="${view}"]`).click();
    const active = await page.locator(`.view[data-view="${view}"]`).evaluate(
      (element) => element.classList.contains('is-active'),
    );
    if (active) activatedViews.push(view);
  }

  const runtimeState = await page.evaluate(async () => ({
    profiles: await window.mina.readProfiles(),
    memory: await window.mina.memoryStatus(),
    status: await window.mina.status(),
  }));
  const webPreferences = await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
    return window?.webContents.getLastWebPreferences();
  });

  const result = {
    welcomeVisible: true,
    profileCount: runtimeState.profiles.profiles.length,
    activeProfile: Boolean(runtimeState.profiles.activeProfileId),
    welcomeCompleted: runtimeState.profiles.welcomeCompleted,
    recoveryPhraseWordCount: phraseWordCount,
    activatedViews,
    memoryUnlocked: runtimeState.memory.locked === false,
    runtimeOk: runtimeState.status.ok === true,
    webPreferences: {
      nodeIntegration: webPreferences.nodeIntegration,
      contextIsolation: webPreferences.contextIsolation,
      sandbox: webPreferences.sandbox,
      webSecurity: webPreferences.webSecurity,
      allowRunningInsecureContent: webPreferences.allowRunningInsecureContent,
    },
    pageErrors,
  };
  assert.equal(result.profileCount, 1);
  assert.equal(result.activeProfile, true);
  assert.equal(result.welcomeCompleted, true);
  assert.deepEqual(result.activatedViews, views);
  assert.equal(result.memoryUnlocked, true);
  assert.deepEqual(result.webPreferences, {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
  });
  assert.deepEqual(pageErrors, []);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  if (application) await application.close();
  const resolvedRuntime = resolve(runtime);
  if (!resolvedRuntime.startsWith(`${resolve(cloneRoot)}\\`)) {
    throw new Error('audit_runtime_cleanup_outside_clone');
  }
  await rm(resolvedRuntime, { recursive: true, force: true, maxRetries: 3 });
}
