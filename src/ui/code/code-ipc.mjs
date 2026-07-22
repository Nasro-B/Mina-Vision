// Enregistrement IPC du domaine Mina Code (côté processus principal) : chaque canal renvoie
// { ok, data } ou { ok: false, error } — jamais d'exception qui traverse l'IPC. Les services
// sont construits PARESSEUSEMENT au premier appel (zéro coût au démarrage de l'app).

const CHANNELS = Object.freeze({
  index: 'mina:code:index',
  status: 'mina:code:status',
  search: 'mina:code:search',
  impact: 'mina:code:impact',
  gitStatus: 'mina:code:git-status',
  gitLog: 'mina:code:git-log',
  gitDiff: 'mina:code:git-diff',
  review: 'mina:code:review',
  testsRun: 'mina:code:tests-run',
  plans: 'mina:code:plans',
});

export function registerCodeIpc({ ipcMain, buildServices, onEvent = () => {} } = {}) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') throw new TypeError('code_ipc_ipc_main_required');
  if (typeof buildServices !== 'function') throw new TypeError('code_ipc_build_services_required');

  let servicesPromise = null;
  const services = () => {
    servicesPromise ??= Promise.resolve().then(buildServices);
    return servicesPromise;
  };

  const guard = (channel, handler) => {
    ipcMain.handle(channel, async (_event, request) => {
      try {
        const active = await services();
        const data = await handler(active, request ?? {});
        return { ok: true, data };
      } catch (error) {
        const message = String(error?.message ?? error).slice(0, 500);
        onEvent({ type: 'code_ipc_error', channel, error: message });
        return { ok: false, error: message };
      }
    });
  };

  guard(CHANNELS.index, (active) => active.indexer.fullIndex({}));
  guard(CHANNELS.status, async (active) => ({
    index: active.indexer.status(),
    projectRoot: active.projectRoot,
    framework: (await active.projectContext()).framework,
  }));
  guard(CHANNELS.search, (active, request) => active.search.search(String(request.query ?? ''), {
    maxResults: Math.min(Math.max(1, Number(request.maxResults) || 10), 50),
  }));
  guard(CHANNELS.impact, (active, request) => active.indexer.impactAnalysis(String(request.file ?? '')));
  guard(CHANNELS.gitStatus, async (active) => {
    if (!(await active.gitClient.isRepository())) return { notRepository: true };
    return { notRepository: false, status: await active.gitStatus.status() };
  });
  guard(CHANNELS.gitLog, async (active, request) => {
    if (!(await active.gitClient.isRepository())) return { notRepository: true, log: [] };
    return { notRepository: false, log: await active.gitLog.log({ maxCount: Math.min(Math.max(1, Number(request.maxCount) || 10), 50) }) };
  });
  guard(CHANNELS.gitDiff, async (active, request) => {
    if (!(await active.gitClient.isRepository())) return { notRepository: true, diff: '' };
    return { notRepository: false, diff: await active.gitDiff.diff({ staged: request.staged === true }) };
  });
  guard(CHANNELS.review, async (active, request) => {
    const files = Array.isArray(request.files) && request.files.length > 0
      ? request.files.slice(0, 50).map(String)
      : active.indexer.indexedFiles().slice(0, 20);
    if (files.length === 0) throw new Error('code_ipc_review_no_files: lancer l\'indexation d\'abord');
    return active.reviewer.review({ files });
  });
  guard(CHANNELS.testsRun, (active, request) => (
    typeof request.file === 'string' && request.file.length > 0
      ? active.testRunner.runFile(request.file, { timeout: 120_000 })
      : active.testRunner.runAll({ timeout: 300_000 })
  ));
  guard(CHANNELS.plans, (active) => active.planStore.list());

  return Object.freeze({ channels: CHANNELS });
}
