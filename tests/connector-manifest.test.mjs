import { describe, expect, it } from 'vitest';
import { validateManifest, CONNECTOR_TYPES, CURRENT_MINA_VERSION } from '../src/connectors/connector-manifest.mjs';

const FAKE_PUBLIC_KEY_PEM = '-----BEGIN PUBLIC KEY-----\nfake-for-schema-shape-tests-only\n-----END PUBLIC KEY-----';

function manifest(overrides = {}) {
  return {
    connectorId: 'nas-reader', name: 'NAS Reader', version: '1.0.0', publisherId: 'pub-1', type: 'declarative-rest',
    capabilities: ['nas.read'], networkAllowlist: ['nas.local'], tlsRequired: true,
    minMinaVersion: '1.0.0', maxMinaVersion: '1.9.9', signature: 'sig', digest: `sha256:${'a'.repeat(64)}`,
    publisherPublicKey: FAKE_PUBLIC_KEY_PEM, secrets: [], ...overrides,
  };
}

describe('CONNECTOR_TYPES', () => {
  it('lists exactly the four allowed connector types', () => {
    expect([...CONNECTOR_TYPES]).toEqual(['declarative-rest', 'declarative-mqtt', 'local-adapter', 'isolated-code']);
  });
});

describe('validateManifest: exact cases from the plan', () => {
  it('rejects a global network wildcard', () => {
    expect(() => validateManifest(manifest({ networkAllowlist: ['*'] }))).toThrow('global_network_wildcard_forbidden');
  });

  it('rejects a raw shell capability', () => {
    expect(() => validateManifest(manifest({ capabilities: ['shell.raw'] }))).toThrow('raw_shell_forbidden');
  });
});

describe('validateManifest: secret value, TLS, digest/signature format, publisher, version', () => {
  it('rejects a manifest declaring a secret VALUE, not just a name', () => {
    expect(() => validateManifest(manifest({ secrets: [{ name: 'apiKey', value: 'sk-real-secret' }] }))).toThrow('manifest_secret_value_forbidden');
  });

  it('accepts a manifest declaring only a secret NAME (no value)', () => {
    expect(() => validateManifest(manifest({ secrets: [{ name: 'apiKey' }] }))).not.toThrow();
  });

  it('rejects tlsRequired:false', () => {
    expect(() => validateManifest(manifest({ tlsRequired: false }))).toThrow('tls_disabled_forbidden');
  });

  it('rejects a malformed digest (not a sha256: hex string)', () => {
    expect(() => validateManifest(manifest({ digest: 'not-a-digest' }))).toThrow();
  });

  it('rejects an unknown connector type', () => {
    expect(() => validateManifest(manifest({ type: 'shell-script' }))).toThrow();
  });

  it('rejects an incompatible Mina version range (current version below the declared minimum)', () => {
    expect(() => validateManifest(manifest({ minMinaVersion: '2.0.0', maxMinaVersion: '2.9.9' }))).toThrow('incompatible_mina_version');
  });

  it('rejects an incompatible Mina version range (current version above the declared maximum)', () => {
    expect(() => validateManifest(manifest({ minMinaVersion: '0.1.0', maxMinaVersion: '0.9.9' }))).toThrow('incompatible_mina_version');
  });

  it('accepts a manifest whose version range covers the current Mina version', () => {
    expect(() => validateManifest(manifest({ minMinaVersion: '1.0.0', maxMinaVersion: CURRENT_MINA_VERSION }))).not.toThrow();
  });

  it('rejects an inverted version range (min greater than max)', () => {
    expect(() => validateManifest(manifest({ minMinaVersion: '2.0.0', maxMinaVersion: '1.0.0' }))).toThrow('manifest_version_range_invalid');
  });

  it('freezes and returns the validated manifest', () => {
    const validated = validateManifest(manifest());
    expect(Object.isFrozen(validated)).toBe(true);
    expect(validated.connectorId).toBe('nas-reader');
  });

  it('accepts each of the four allowed connector types', () => {
    for (const type of CONNECTOR_TYPES) {
      expect(() => validateManifest(manifest({ type }))).not.toThrow();
    }
  });
});
