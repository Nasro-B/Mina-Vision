import { describe, expect, it, vi } from 'vitest';
import { loadGoogleClientConfigFromEnvDir } from '../src/mail/oauth/google-client-config-file.mjs';

const REAL_SHAPE_JSON = JSON.stringify({
  installed: {
    client_id: '486101146642-fake.apps.googleusercontent.com',
    project_id: 'mina-vission',
    auth_uri: 'https://accounts.google.com/o/oauth2/auth',
    token_uri: 'https://oauth2.googleapis.com/token',
    auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
    client_secret: 'GOCSPX-fake-secret-value',
    redirect_uris: ['http://localhost'],
  },
});

describe('loadGoogleClientConfigFromEnvDir', () => {
  it('returns null when the env directory does not exist', () => {
    const readdirSync = vi.fn(() => { throw new Error('ENOENT'); });
    const readFileSync = vi.fn();
    expect(loadGoogleClientConfigFromEnvDir('C:\\nope', { readdirSync, readFileSync })).toBeNull();
    expect(readFileSync).not.toHaveBeenCalled();
  });

  it('returns null when no client_secret_*.json file is present', () => {
    const readdirSync = vi.fn(() => ['.gitignore', 'README.md', 'other.json']);
    const readFileSync = vi.fn();
    expect(loadGoogleClientConfigFromEnvDir('C:\\env', { readdirSync, readFileSync })).toBeNull();
    expect(readFileSync).not.toHaveBeenCalled();
  });

  it('parses the real Google Cloud Console "installed" (Desktop app) shape', () => {
    const readdirSync = vi.fn(() => ['client_secret_486101146642-fake.apps.googleusercontent.com.json']);
    const readFileSync = vi.fn(() => REAL_SHAPE_JSON);
    const result = loadGoogleClientConfigFromEnvDir('C:\\env', { readdirSync, readFileSync });
    expect(result).toEqual({
      clientId: '486101146642-fake.apps.googleusercontent.com',
      clientSecret: 'GOCSPX-fake-secret-value',
      projectId: 'mina-vission',
    });
    expect(readFileSync).toHaveBeenCalledWith('C:\\env/client_secret_486101146642-fake.apps.googleusercontent.com.json', 'utf8');
  });

  it('also accepts the "web" client shape', () => {
    const readdirSync = vi.fn(() => ['client_secret_x.json']);
    const readFileSync = vi.fn(() => JSON.stringify({ web: { client_id: 'web-id', client_secret: 'web-secret' } }));
    expect(loadGoogleClientConfigFromEnvDir('C:\\env', { readdirSync, readFileSync }))
      .toEqual({ clientId: 'web-id', clientSecret: 'web-secret' });
  });

  it('returns null when the matched file is missing client_id or client_secret', () => {
    const readdirSync = vi.fn(() => ['client_secret_incomplete.json']);
    const readFileSync = vi.fn(() => JSON.stringify({ installed: { client_id: 'only-id' } }));
    expect(loadGoogleClientConfigFromEnvDir('C:\\env', { readdirSync, readFileSync })).toBeNull();
  });

  it('picks the client_secret file among unrelated files in the same directory', () => {
    const readdirSync = vi.fn(() => ['build.gradle.kts', 'debug.keystore', 'client_secret_486101146642.json', 'LICENSE']);
    const readFileSync = vi.fn(() => REAL_SHAPE_JSON);
    const result = loadGoogleClientConfigFromEnvDir('C:\\env', { readdirSync, readFileSync });
    expect(result).not.toBeNull();
    expect(readFileSync).toHaveBeenCalledWith('C:\\env/client_secret_486101146642.json', 'utf8');
  });
});
