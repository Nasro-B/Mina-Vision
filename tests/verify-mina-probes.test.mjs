import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  probeGoogleHomeSdk,
  probeHomeDomain,
  probeMailAccounts,
  resolveGoogleHomeSdkPath,
  resolveMailUserDataDirs,
} from '../scripts/verify-mina-probes.mjs';

describe('verify-mina probes: mail', () => {
  it('marks mail unavailable when no keyring exists', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'mina-verify-mail-'));
    try {
      const result = await probeMailAccounts({ userDataDirs: [root] });
      expect(result).toEqual({ ready: false, reason: 'mail_keyring_missing' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('maps gmail client/config status from keyring secrets', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'mina-verify-mail-'));
    const keyringPath = path.join(root, 'mina-keyring.json');

    try {
      await writeFile(keyringPath, JSON.stringify({ version: 1 }), 'utf8');
      const emptyKeyring = await probeMailAccounts({ userDataDirs: [root] });
      expect(emptyKeyring).toEqual({ ready: false, reason: 'google_oauth_client_config_missing' });

      await writeFile(keyringPath, JSON.stringify({ version: 1, secrets: { some: 'z' } }), 'utf8');
      const missingConfig = await probeMailAccounts({ userDataDirs: [root] });
      expect(missingConfig).toEqual({ ready: false, reason: 'google_oauth_client_config_missing' });

      await writeFile(keyringPath, JSON.stringify({
        version: 1,
        secrets: { 'google/oauth/client-config': '{}', 'mail/account/google-primary': 'x' },
      }), 'utf8');
      const ready = await probeMailAccounts({ userDataDirs: [root] });
      expect(ready).toEqual({ ready: true });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('falls back across userData directories and keeps last-missing reason if none is provisioned', async () => {
    const first = await mkdtemp(path.join(tmpdir(), 'mina-verify-mail-'));
    const second = await mkdtemp(path.join(tmpdir(), 'mina-verify-mail-'));
    try {
      const result = await probeMailAccounts({ userDataDirs: [first, second] });
      expect(result).toEqual({ ready: false, reason: 'mail_keyring_missing' });

      await writeFile(path.join(second, 'mina-keyring.json'), JSON.stringify({
        version: 1,
        secrets: { 'google/oauth/client-config': '{}', 'mail/account/google-primary': '{}' },
      }), 'utf8');
      const discovered = await probeMailAccounts({ userDataDirs: [first, second] });
      expect(discovered).toEqual({ ready: true });
    } finally {
      await rm(first, { recursive: true, force: true });
      await rm(second, { recursive: true, force: true });
    }
  });

  it('exposes non-sensitive OAuth project details when the account is not connected', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'mina-verify-mail-'));
    try {
      await writeFile(path.join(root, 'mina-keyring.json'), JSON.stringify({
        version: 1,
        secrets: { 'google/oauth/client-config': '{}' },
      }), 'utf8');

      const result = await probeMailAccounts({
        userDataDirs: [root],
        googleClientConfig: { projectId: 'mina-vission' },
        firebaseProjectId: 'mina-vision',
      });

      expect(result).toEqual({
        ready: false,
        reason: 'mail_account_missing',
        oauthProjectId: 'mina-vission',
        firebaseProjectId: 'mina-vision',
        oauthProjectMatchesFirebase: false,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('verify-mina probes: home', () => {
  it('marks home unavailable when no connector is configured', () => {
    expect(probeHomeDomain({ env: {} })).toEqual({
      ready: false,
      reason: 'aucun_connecteur_configure',
      homeAssistantBaseUrlConfigured: false,
      homeAssistantAuthConfigured: false,
      mqttBrokerConfigured: false,
    });
  });

  it('marks home unavailable when HA config is incomplete', () => {
    expect(probeHomeDomain({ env: { HOME_ASSISTANT_BASE_URL: 'https://homeassistant.local:8123' } }))
      .toEqual({
        ready: false,
        reason: 'home_assistant_config_incomplete',
        homeAssistantBaseUrlConfigured: true,
        homeAssistantAuthConfigured: false,
        mqttBrokerConfigured: false,
      });
  });

  it('marks home configured when HA base URL + token are present', () => {
    expect(probeHomeDomain({ env: {
      HOME_ASSISTANT_BASE_URL: 'https://homeassistant.local:8123',
      HOME_ASSISTANT_TOKEN: 'tok',
    } })).toMatchObject({
      ready: true,
      connectors: ['home-assistant'],
      homeAssistantBaseUrlConfigured: true,
      homeAssistantAuthConfigured: true,
    });
  });
});

describe('verify-mina probes: google home sdk', () => {
  it('marks the Google Home SDK unavailable when no SDK path can be resolved', async () => {
    await expect(probeGoogleHomeSdk({ env: {} })).resolves
      .toEqual({ ready: false, reason: 'google_home_sdk_unavailable' });
  });

  it('reports the expected Google Home SDK manifest path without marking it ready', async () => {
    await expect(probeGoogleHomeSdk({ env: { USERPROFILE: 'C:\\Users\\Nasro' } })).resolves
      .toEqual({
        ready: false,
        reason: 'google_home_sdk_unavailable',
        expectedPath: 'C:\\Users\\Nasro\\.mina\\sdk\\google-home\\1.9',
        manifestPath: 'C:\\Users\\Nasro\\.mina\\sdk\\google-home\\1.9\\manifest.json',
      });
  });

  it('marks the Google Home SDK ready only when its manifest is present', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'mina-google-home-sdk-'));
    try {
      await mkdir(root, { recursive: true });
      await writeFile(path.join(root, 'manifest.json'), '{"name":"google-home"}', 'utf8');
      expect(resolveGoogleHomeSdkPath({ env: { MINA_GOOGLE_HOME_SDK_PATH: root } })).toBe(path.resolve(root));
      await expect(probeGoogleHomeSdk({ env: { MINA_GOOGLE_HOME_SDK_PATH: root } })).resolves
        .toEqual({
          ready: true,
          expectedPath: path.resolve(root),
          manifestPath: path.join(path.resolve(root), 'manifest.json'),
        });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('verify-mina probes: config helpers', () => {
  it('resolves mail keyring directories from APPDATA legacy and explicit values', () => {
    const dirs = resolveMailUserDataDirs({ appData: 'C:\\Users\\Test\\AppData\\Roaming', explicitDir: 'D:\\MinaData' });
    expect(dirs).toEqual([
      'D:\\MinaData',
      'C:\\Users\\Test\\AppData\\Roaming\\Mina Vision',
      'C:\\Users\\Test\\AppData\\Roaming\\agentvisionsourire',
    ]);
  });
});
