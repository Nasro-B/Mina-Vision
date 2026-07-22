export const GMAIL_SCOPES = Object.freeze({
  readonly: 'https://www.googleapis.com/auth/gmail.readonly',
  modify: 'https://www.googleapis.com/auth/gmail.modify',
  send: 'https://www.googleapis.com/auth/gmail.send',
  compose: 'https://www.googleapis.com/auth/gmail.compose',
  labels: 'https://www.googleapis.com/auth/gmail.labels',
});
const FORBIDDEN_FULL_SCOPE = 'https://mail.google.com/';

export async function createGoogleOAuthClient({
  clientId,
  clientSecret,
  redirectUri,
  importOAuth2Client = () => import('google-auth-library').then((module) => module.OAuth2Client),
} = {}) {
  if (typeof clientId !== 'string' || clientId.length < 1
    || typeof clientSecret !== 'string' || clientSecret.length < 1
    || typeof redirectUri !== 'string' || !redirectUri.startsWith('http')) {
    throw new TypeError('google_oauth_configuration_invalid');
  }
  const OAuth2Client = await importOAuth2Client();
  const client = new OAuth2Client({ clientId, clientSecret, redirectUri });

  return Object.freeze({
    generateConsentUrl(scopes, { state } = {}) {
      if (!Array.isArray(scopes) || scopes.length < 1 || scopes.includes(FORBIDDEN_FULL_SCOPE)) {
        throw new TypeError('google_oauth_scope_invalid');
      }
      const request = { access_type: 'offline', prompt: 'consent', scope: scopes };
      if (state !== undefined) request.state = state;
      return client.generateAuthUrl(request);
    },

    async exchangeCode(code) {
      if (typeof code !== 'string' || code.length < 1) throw new TypeError('google_oauth_code_invalid');
      const { tokens } = await client.getToken(code);
      if (!tokens?.refresh_token) throw new Error('google_oauth_refresh_token_missing');
      return Object.freeze({
        accessToken: tokens.access_token ?? null,
        refreshToken: tokens.refresh_token,
        expiryDate: tokens.expiry_date ?? null,
      });
    },

    async request(credentials, options) {
      if (typeof credentials?.refreshToken !== 'string' || credentials.refreshToken.length < 1) {
        throw new TypeError('google_oauth_credentials_invalid');
      }
      client.setCredentials({
        refresh_token: credentials.refreshToken,
        access_token: credentials.accessToken ?? undefined,
        expiry_date: credentials.expiryDate ?? undefined,
      });
      const response = await client.request(options);
      const updated = client.credentials ?? {};
      return {
        response,
        refreshed: Object.freeze({
          accessToken: updated.access_token ?? credentials.accessToken ?? null,
          refreshToken: updated.refresh_token ?? credentials.refreshToken,
          expiryDate: updated.expiry_date ?? credentials.expiryDate ?? null,
        }),
      };
    },
  });
}
