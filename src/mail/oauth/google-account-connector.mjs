import { randomBytes } from 'node:crypto';
import { createOAuthLoopbackServer } from './oauth-loopback-server.mjs';
import { createGoogleOAuthClient } from './google-oauth.mjs';

const CLIENT_CONFIG_SECRET = 'google/oauth/client-config';

// All the real decision logic behind `scripts/connect-google-account.mjs`, extracted so it can be
// tested without Electron, a real browser, or a real Google account — every dependency the script
// needs (keyring, prompt, browser opener, loopback server, OAuth client, account store) is injected,
// matching the same pattern used everywhere else in this codebase. The script itself stays a thin
// wrapper that supplies the real Electron-bound implementations of each.
export function createGoogleAccountConnector({
  storage, keyring, mailAccountStore, prompt, openExternal,
  createLoopbackServer = createOAuthLoopbackServer,
  createOAuthClient = createGoogleOAuthClient,
  generateState = () => randomBytes(16).toString('hex'),
  scopes, accountId, address, clock = Date.now, onConsentUrl = () => {},
  manualClientConfigAllowed = true,
} = {}) {
  if (!keyring?.getSecret || !keyring?.setSecret) throw new TypeError('google_account_connector_keyring_required');
  if (!storage?.read) throw new TypeError('google_account_connector_storage_required');
  if (!mailAccountStore?.save) throw new TypeError('google_account_connector_mail_account_store_required');
  if (typeof prompt !== 'function') throw new TypeError('google_account_connector_prompt_required');
  if (typeof openExternal !== 'function') throw new TypeError('google_account_connector_open_external_required');
  if (!Array.isArray(scopes) || scopes.length === 0) throw new TypeError('google_account_connector_scopes_required');
  if (typeof accountId !== 'string' || !accountId) throw new TypeError('google_account_connector_account_id_required');
  if (typeof address !== 'string' || !address) throw new TypeError('google_account_connector_address_required');

  return Object.freeze({
    async connect() {
      // getSecret()/hasSecret() never throw for an uninitialized vault (they just return null/false,
      // indistinguishable from "initialized but this secret unset") — only setSecret() does, and
      // only after already prompting. Reading the raw storage record catches it up front instead.
      if (!(await storage.read())) return Object.freeze({ status: 'vault_not_initialized' });

      const clientConfigRaw = await keyring.getSecret(CLIENT_CONFIG_SECRET);
      let clientId;
      let clientSecret;
      let shouldPersistClientConfig = false;
      if (clientConfigRaw) {
        ({ clientId, clientSecret } = JSON.parse(clientConfigRaw));
      } else {
        if (manualClientConfigAllowed === false) return Object.freeze({ status: 'client_config_file_required' });
        clientId = await prompt('Client ID Google : ');
        clientSecret = await prompt('Client Secret Google : ');
        if (!clientId || !clientSecret) return Object.freeze({ status: 'client_config_required' });
        shouldPersistClientConfig = true;
      }

      const state = generateState();
      const loopback = createLoopbackServer({ expectedState: state });
      const { port } = await loopback.start();
      const redirectUri = `http://127.0.0.1:${port}/oauth/callback`;
      const oauth = await createOAuthClient({ clientId, clientSecret, redirectUri });
      const consentUrl = oauth.generateConsentUrl(scopes, { state });
      onConsentUrl(consentUrl);
      await openExternal(consentUrl);

      let result;
      try {
        result = await loopback.waitForCode();
      } catch (error) {
        await loopback.stop();
        return Object.freeze({ status: 'denied', reason: error.message });
      }
      await loopback.stop();

      const tokens = await oauth.exchangeCode(result.code);
      if (shouldPersistClientConfig) {
        await keyring.setSecret(CLIENT_CONFIG_SECRET, JSON.stringify({ clientId, clientSecret }));
      }
      await mailAccountStore.save(accountId, {
        provider: 'gmail', address, mode: 1, credentials: tokens,
      });

      return Object.freeze({ status: 'connected', accountId });
    },
  });
}
