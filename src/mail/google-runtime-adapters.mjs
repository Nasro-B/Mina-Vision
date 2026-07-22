import { createGmailAdapter } from './adapters/gmail.mjs';
import { createGoogleOAuthClient } from './oauth/google-oauth.mjs';
import { createGooglePersonalAdapter } from '../personal/adapters/google-personal.mjs';

export async function createGoogleRuntimeAdapters({
  accounts = [], getClientConfig, getCredentials, createOAuthClient = createGoogleOAuthClient,
} = {}) {
  if (!Array.isArray(accounts) || typeof getClientConfig !== 'function' || typeof getCredentials !== 'function'
    || typeof createOAuthClient !== 'function') throw new TypeError('google_runtime_adapters_dependencies_required');
  const googleAccounts = accounts.filter((account) => String(account.provider).toLowerCase() === 'gmail');
  if (googleAccounts.length === 0) {
    return Object.freeze({ mailAdapters: Object.freeze({}), googlePersonalAdapter: null, operationalAccountIds: Object.freeze([]), reason: 'google_account_missing' });
  }
  const raw = await getClientConfig();
  if (!raw) {
    return Object.freeze({ mailAdapters: Object.freeze({}), googlePersonalAdapter: null, operationalAccountIds: Object.freeze([]), reason: 'google_oauth_client_config_missing' });
  }
  let config;
  try { config = JSON.parse(raw); } catch { throw new Error('google_oauth_client_config_invalid'); }
  const oauth = await createOAuthClient({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri: 'http://127.0.0.1/oauth/callback',
  });
  const mailAdapters = {};
  for (const account of googleAccounts) {
    const adapter = createGmailAdapter({ account: { id: account.accountId, address: account.address }, oauth });
    mailAdapters[account.accountId] = Object.freeze({
      sync: (request) => adapter.sync({ ...request, credentialsProvider: getCredentials }),
      createDraft: (request) => adapter.createDraft({ ...request, credentialsProvider: getCredentials }),
      send: (request) => adapter.send({ ...request, credentialsProvider: getCredentials }),
    });
  }
  const primary = googleAccounts[0];
  const googlePersonalAdapter = createGooglePersonalAdapter({
    oauth: { request: async (credentials, options) => (await oauth.request(credentials, options)).response },
    credentialsProvider: () => getCredentials(primary.accountId),
  });
  return Object.freeze({
    mailAdapters: Object.freeze(mailAdapters),
    googlePersonalAdapter,
    operationalAccountIds: Object.freeze(googleAccounts.map((account) => account.accountId)),
    reason: null,
  });
}
