import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createPreloadApi } = require('../src/ui/preload.cjs');

describe('preload API', () => {
  it('exposes read-only grounding projections without any proof publication method', async () => {
    const ipcRenderer = {
      invoke: vi.fn().mockResolvedValue({}),
      on: vi.fn(),
      removeListener: vi.fn(),
      send: vi.fn(),
    };
    const api = createPreloadApi(ipcRenderer);

    await api.sessionState();
    await api.claims();
    await api.groundingStatus();
    await api.memoryStatus();
    await api.unlockMemory();
    await api.searchMemory({ query: 'mardi' });
    await api.proposeForget({ criteria: { subject: 'mardi' } });
    await api.readFile({ path: 'C:\\Docs\\note.txt' });
    await api.readWeb({ url: 'https://example.test/' });
    await api.skillsSandboxStatus();
    await api.chooseAndStageSkill();
    await api.installSkill({ quarantineId: 'q-1' });
    await api.executeSandbox({ proposalId: 'proposal-1' });
    await api.cancelSandbox({ jobId: 'job-1' });
    await api.importSandboxArtifact({ jobId: 'job-1', artifactId: 'artifact-1' });
    await api.sendSmsConfirmed({ sourceMessageId: 'sms-1', recipientE164: '+33600000000', text: 'Bonjour' });
    await api.syncPhoneMessages();
    await api.startPhoneCamera();
    await api.stopPhoneCamera();
    await api.settingsSchema();
    await api.settingsState();
    await api.updateSettings({ MINA_INFERENCE_MODE: 'local-only' });
    await api.setProviderSecret({ providerId: 'deepseek', value: 'secret' });
    await api.revokeProviderSecret({ providerId: 'deepseek' });
    await api.testProvider({ providerId: 'lmStudio' });
    await api.queryAnalytics({ from: '2026-07-01T00:00:00.000Z', to: '2026-07-15T23:59:59.999Z' });
    await api.analyticsBudgets({ type: 'daily' });
    await api.exportAnalytics({ from: '2026-07-01T00:00:00.000Z', to: '2026-07-15T23:59:59.999Z', format: 'json' });
    await api.connectGoogleBrowser();
    await api.searchYouTube({ query: 'Daft Punk', maxResults: 1 });

    expect(ipcRenderer.invoke.mock.calls.map(([channel]) => channel)).toEqual([
      'mina:session-state',
      'mina:claims',
      'mina:grounding-status',
      'memory.status',
      'memory.unlock',
      'memory.search',
      'memory.proposeForget',
      'research.readFile',
      'research.readWeb',
      'mina:skills-sandbox:status',
      'mina:skills:choose-stage',
      'mina:skills:install',
      'mina:sandbox:execute',
      'mina:sandbox:cancel',
      'mina:sandbox:import-artifact',
      'mina:sms-send-confirmed',
      'mina:phone-sync-messages',
      'mina:phone-camera',
      'mina:phone-camera-stop',
      'mina:settings:get-schema',
      'mina:settings:get',
      'mina:settings:update',
      'mina:settings:set-secret',
      'mina:settings:revoke-secret',
      'mina:settings:test-provider',
      'mina:analytics:query',
      'mina:analytics:budgets',
      'mina:analytics:export',
      'mina:browser:google-login',
      'mina:youtube-search',
    ]);
    expect(api.publishClaim).toBeUndefined();
    expect(api.publishEvidence).toBeUndefined();
    expect(typeof api.onCameraFrame).toBe('function');
    expect(Object.isFrozen(api)).toBe(true);
  });
});
