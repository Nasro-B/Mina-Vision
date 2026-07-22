import { generateKeyPairSync, sign as cryptoSign, createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createConnectorInstaller } from '../src/connectors/connector-installer.mjs';
import { createPublisherTrustStore } from '../src/connectors/publisher-trust-store.mjs';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const OTHER_KEY_PAIR = generateKeyPairSync('rsa', { modulusLength: 2048 });
const OTHER_PUBLIC_KEY_PEM = OTHER_KEY_PAIR.publicKey.export({ type: 'spki', format: 'pem' }).toString();

const PACKAGE_DIGEST = `sha256:${'a'.repeat(64)}`;

function manifest(overrides = {}) {
  const base = {
    connectorId: 'nas-reader', name: 'NAS Reader', version: '1.0.0', publisherId: 'pub-1', type: 'declarative-rest',
    capabilities: ['nas.read'], networkAllowlist: ['nas.local'], tlsRequired: true,
    minMinaVersion: '1.0.0', maxMinaVersion: '1.9.9', digest: PACKAGE_DIGEST, publisherPublicKey: publicKeyPem, secrets: [],
  };
  const merged = { ...base, ...overrides };
  if (!('signature' in overrides)) {
    merged.signature = cryptoSign('sha256', Buffer.from(merged.digest, 'utf8'), privateKey).toString('base64');
  }
  return merged;
}

function fakeRepository() {
  const rows = new Map();
  return { put: vi.fn(async (id, r) => rows.set(id, r)), get: vi.fn(async (id) => rows.get(id) ?? null) };
}

function fakeZipInspector({ valid = true, reason, manifestJson, packageDigest = PACKAGE_DIGEST } = {}) {
  return { inspect: vi.fn(async () => ({ valid, reason, manifestText: manifestJson ?? JSON.stringify(manifest()), packageDigest })) };
}

function fakeFilesystem() {
  const files = new Map();
  return { files, readFile: vi.fn(async (path) => files.get(path) ?? Buffer.from('zip-bytes')), writeFile: vi.fn(async (path, bytes) => files.set(path, bytes)) };
}

function buildInstaller({ zipInspector, ...overrides } = {}) {
  const trustStore = createPublisherTrustStore({ repository: fakeRepository(), clock: () => 1_700_000_000_000 });
  const dependencyScanner = { scan: vi.fn(async () => []) };
  const filesystem = fakeFilesystem();
  const installer = createConnectorInstaller({
    trustStore, zipInspector: zipInspector ?? fakeZipInspector(), dependencyScanner, filesystem, clock: () => 1_700_000_000_000, ...overrides,
  });
  return { installer, trustStore, dependencyScanner, filesystem };
}

describe('createConnectorInstaller: constructor guards', () => {
  it('requires a trustStore', () => {
    expect(() => createConnectorInstaller({})).toThrow('connector_installer_trust_store_required');
  });
});

describe('createConnectorInstaller.importPackage: ZIP traversal rejected', () => {
  it('rejects a package flagged by the zip inspector as containing a traversal entry', async () => {
    const zipInspector = fakeZipInspector({ valid: false, reason: 'connector_zip_traversal_forbidden' });
    const { installer } = buildInstaller({ zipInspector });
    await expect(installer.importPackage('pkg.zip')).rejects.toThrow('connector_zip_traversal_forbidden');
  });
});

describe('createConnectorInstaller.importPackage: digest verified before signature', () => {
  it('rejects a package digest mismatch without ever checking the signature', async () => {
    const zipInspector = fakeZipInspector({ packageDigest: `sha256:${'b'.repeat(64)}` });
    const poisonTrustStore = {
      isApproved: vi.fn(), approvePublisher: vi.fn(),
      verifySignature: vi.fn(() => { throw new Error('verifySignature_should_not_be_called'); }),
    };
    const { installer } = buildInstaller({ zipInspector, trustStore: poisonTrustStore });
    await expect(installer.importPackage('pkg.zip')).rejects.toThrow('package_digest_mismatch');
    expect(poisonTrustStore.verifySignature).not.toHaveBeenCalled();
  });

  it('rejects a real, well-formed signature that does not match the embedded public key (wrong signer)', async () => {
    const zipInspector = fakeZipInspector({ manifestJson: JSON.stringify(manifest({ publisherPublicKey: OTHER_PUBLIC_KEY_PEM })) });
    const { installer } = buildInstaller({ zipInspector });
    await expect(installer.importPackage('pkg.zip')).rejects.toThrow('package_signature_invalid');
  });

  it('rejects a garbage signature string outright', async () => {
    const zipInspector = fakeZipInspector({ manifestJson: JSON.stringify(manifest({ signature: 'not-a-real-signature' })) });
    const { installer } = buildInstaller({ zipInspector });
    await expect(installer.importPackage('pkg.zip')).rejects.toThrow('package_signature_invalid');
  });

  it('accepts a genuinely valid RSA signature over the digest', async () => {
    const { installer } = buildInstaller();
    await expect(installer.importPackage('pkg.zip')).resolves.toMatchObject({ status: 'quarantined_unknown_publisher' });
  });
});

describe('createConnectorInstaller.importPackage: unknown publishers stay quarantined', () => {
  it('quarantines a package from a publisher never approved, even with a valid signature', async () => {
    const { installer } = buildInstaller();
    const job = await installer.importPackage('pkg.zip');
    expect(job.status).toBe('quarantined_unknown_publisher');
  });

  it('marks a package ready_to_install once the publisher is already approved', async () => {
    const { installer, trustStore } = buildInstaller();
    await trustStore.approvePublisher({ publisherId: 'pub-1', fingerprint: 'fp-1', publicKey: publicKeyPem });
    const job = await installer.importPackage('pkg.zip');
    expect(job.status).toBe('ready_to_install');
  });

  it('writes the package bytes into a quarantine path regardless of trust status', async () => {
    const { installer, filesystem } = buildInstaller();
    const job = await installer.importPackage('pkg.zip');
    expect(filesystem.files.has(`connectors/quarantine/${job.jobId}.zip`)).toBe(true);
  });
});

describe('createConnectorInstaller.inspect / approvePublisher / install', () => {
  it('inspect returns the stored job', async () => {
    const { installer } = buildInstaller();
    const job = await installer.importPackage('pkg.zip');
    expect(await installer.inspect(job.jobId)).toEqual(job);
  });

  it('rejects inspecting an unknown job', async () => {
    const { installer } = buildInstaller();
    await expect(installer.inspect('missing')).rejects.toThrow('connector_job_not_found');
  });

  it('rejects installing a still-quarantined (unapproved publisher) job', async () => {
    const { installer } = buildInstaller();
    const job = await installer.importPackage('pkg.zip');
    await expect(installer.install(job.jobId)).rejects.toThrow('connector_publisher_not_approved');
  });

  it('installs once the publisher has been approved (even after import)', async () => {
    const { installer, trustStore } = buildInstaller();
    const job = await installer.importPackage('pkg.zip');
    await trustStore.approvePublisher({ publisherId: 'pub-1', fingerprint: 'fp-1', publicKey: publicKeyPem });
    const installed = await installer.install(job.jobId);
    expect(installed.status).toBe('installed');
  });

  it('rejects installing an unknown job', async () => {
    const { installer } = buildInstaller();
    await expect(installer.install('missing')).rejects.toThrow('connector_job_not_found');
  });
});

describe('publisher-trust-store.verifySignature: real RSA crypto, not a stub', () => {
  it('verifies a real signature made with the matching private key', async () => {
    const trustStore = createPublisherTrustStore({ repository: fakeRepository(), clock: () => 0 });
    const digest = PACKAGE_DIGEST;
    const signature = cryptoSign('sha256', Buffer.from(digest, 'utf8'), privateKey).toString('base64');
    expect(await trustStore.verifySignature({ publicKey: publicKeyPem, digest, signature })).toBe(true);
  });

  it('rejects a signature made with a different private key', async () => {
    const trustStore = createPublisherTrustStore({ repository: fakeRepository(), clock: () => 0 });
    const digest = PACKAGE_DIGEST;
    const signature = cryptoSign('sha256', Buffer.from(digest, 'utf8'), OTHER_KEY_PAIR.privateKey).toString('base64');
    expect(await trustStore.verifySignature({ publicKey: publicKeyPem, digest, signature })).toBe(false);
  });

  it('rejects when the digest was tampered with after signing', async () => {
    const trustStore = createPublisherTrustStore({ repository: fakeRepository(), clock: () => 0 });
    const signature = cryptoSign('sha256', Buffer.from(PACKAGE_DIGEST, 'utf8'), privateKey).toString('base64');
    const tamperedDigest = `sha256:${'b'.repeat(64)}`;
    expect(await trustStore.verifySignature({ publicKey: publicKeyPem, digest: tamperedDigest, signature })).toBe(false);
  });
});
