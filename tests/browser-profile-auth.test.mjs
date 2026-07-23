import { describe, expect, it, vi } from 'vitest';
import { createBrowserProfileAuthenticator } from '../src/executors/browser-profile-auth.mjs';

describe('browser profile authentication', () => {
  it('opens Google sign-in in normal Chrome with Mina Vision persistent profile', async () => {
    const child = { pid: 4242, unref: vi.fn() };
    const spawnProcess = vi.fn(() => child);
    const authenticator = createBrowserProfileAuthenticator({
      profileDir: 'C:\\Users\\Exemple\\AppData\\Roaming\\agentvisionsourire\\mina-chrome-profile',
      chromeCandidates: ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'],
      exists: vi.fn(() => true),
      spawnProcess,
    });

    await expect(authenticator.openGoogleSignIn()).resolves.toMatchObject({ launched: true, pid: 4242 });
    expect(spawnProcess).toHaveBeenCalledWith(
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      expect.arrayContaining([
        '--user-data-dir=C:\\Users\\Exemple\\AppData\\Roaming\\agentvisionsourire\\mina-chrome-profile',
        '--profile-directory=Default',
        'https://accounts.google.com/ServiceLogin?service=mail',
      ]),
      expect.objectContaining({ detached: true, stdio: 'ignore' }),
    );
    expect(child.unref).toHaveBeenCalledOnce();
  });

  it('fails clearly when normal Chrome is unavailable', async () => {
    const authenticator = createBrowserProfileAuthenticator({
      profileDir: 'C:\\Mina\\profile',
      chromeCandidates: ['C:\\missing\\chrome.exe'],
      exists: vi.fn(() => false),
      spawnProcess: vi.fn(),
    });

    await expect(authenticator.openGoogleSignIn()).rejects.toThrow('chrome_executable_not_found');
  });
});
