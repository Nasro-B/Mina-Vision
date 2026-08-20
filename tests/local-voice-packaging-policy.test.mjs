import { describe, expect, it } from 'vitest';

describe('local voice packaging policy', () => {
  it('closes the source/APK publication decision while gating bundled Electron installers', async () => {
    const {
      evaluateLocalVoicePackaging,
      localVoicePackagingCapability,
    } = await import('../src/voice/local-voice-packaging-policy.mjs');

    expect(evaluateLocalVoicePackaging({ artifact: 'source-repository' })).toEqual({
      artifact: 'source-repository',
      status: 'allowed',
      reason: null,
    });
    expect(evaluateLocalVoicePackaging({ artifact: 'android-apk' })).toEqual({
      artifact: 'android-apk',
      status: 'allowed',
      reason: null,
    });
    expect(evaluateLocalVoicePackaging({ artifact: 'electron-bundled-installer' })).toEqual({
      artifact: 'electron-bundled-installer',
      status: 'blocked',
      reason: 'electron_installer_gpl_source_obligation_open',
    });
    expect(localVoicePackagingCapability()).toEqual({
      id: 'packaging.local_voice',
      status: 'degraded',
      reason: 'electron_installer_gpl_source_obligation_open',
    });
  });
});
