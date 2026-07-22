function normalizeAuthResult(result) {
  if (typeof result?.accessToken !== 'string' || result.accessToken.length < 1
    || typeof result?.account?.tenantId !== 'string' || typeof result?.account?.username !== 'string') {
    throw new Error('microsoft_oauth_result_invalid');
  }
  return Object.freeze({
    accessToken: result.accessToken,
    expiresOn: result.expiresOn instanceof Date ? result.expiresOn.toISOString() : null,
    tenantId: result.account.tenantId,
    username: result.account.username,
  });
}

export async function createMicrosoftOAuthClient({
  clientId,
  authority = 'https://login.microsoftonline.com/common',
  importPublicClientApplication = () => import('@azure/msal-node').then((module) => module.PublicClientApplication),
} = {}) {
  if (typeof clientId !== 'string' || clientId.length < 1) throw new TypeError('microsoft_oauth_configuration_invalid');
  const PublicClientApplication = await importPublicClientApplication();
  const app = new PublicClientApplication({ auth: { clientId, authority } });

  return Object.freeze({
    async requestDeviceCode(scopes, deviceCodeCallback) {
      if (!Array.isArray(scopes) || scopes.length < 1) throw new TypeError('microsoft_oauth_scope_invalid');
      if (typeof deviceCodeCallback !== 'function') throw new TypeError('microsoft_oauth_device_code_callback_required');
      const result = await app.acquireTokenByDeviceCode({ scopes, deviceCodeCallback });
      return normalizeAuthResult(result);
    },

    getAuthCodeUrl(scopes, redirectUri) {
      if (!Array.isArray(scopes) || scopes.length < 1 || typeof redirectUri !== 'string' || !redirectUri.startsWith('http')) {
        throw new TypeError('microsoft_oauth_scope_invalid');
      }
      return app.getAuthCodeUrl({ scopes, redirectUri });
    },

    async exchangeCode({ code, scopes, redirectUri } = {}) {
      if (typeof code !== 'string' || code.length < 1) throw new TypeError('microsoft_oauth_code_invalid');
      const result = await app.acquireTokenByCode({ code, scopes, redirectUri });
      return normalizeAuthResult(result);
    },

    async refresh({ refreshToken, scopes } = {}) {
      if (typeof refreshToken !== 'string' || refreshToken.length < 1) throw new TypeError('microsoft_oauth_refresh_token_invalid');
      const result = await app.acquireTokenByRefreshToken({ refreshToken, scopes });
      return normalizeAuthResult(result);
    },
  });
}
