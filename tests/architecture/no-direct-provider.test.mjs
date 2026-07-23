import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../../src');

// SDKs that must only ever be imported (statically or dynamically) from their designated
// adapter/provider directory. A match anywhere else means a domain bypassed its own service
// layer and is talking to a third-party network SDK directly.
const RESTRICTED_PACKAGES = Object.freeze({
  'imapflow': ['mail'],
  'nodemailer': ['mail'],
  'google-auth-library': ['mail'],
  '@azure/msal-node': ['mail'],
  'mqtt': ['home'],
  // `ws` sert deux transports distincts : le pont domotique local (home) et le canal de
  // l'application Mina sur téléphone appairé (devices/chat-server.mjs). Ce sont les deux
  // adaptateurs réseau autorisés — aucun autre domaine ne parle WebSocket directement.
  'ws': ['home', 'devices'],
  '@google/genai': ['providers'],
  '@google/generative-ai': ['providers'],
  'openai': ['providers'],
  'onnxruntime-node': ['biometrics'],
});

async function walk(directory, files = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(absolute, files);
    } else if (entry.isFile() && (absolute.endsWith('.mjs') || absolute.endsWith('.cjs'))) {
      files.push(absolute);
    }
  }
  return files;
}

describe('architecture: no direct third-party SDK call outside its adapter directory', () => {
  it('finds every restricted package import only inside its designated domain', { timeout: 30_000 }, async () => {
    const files = await walk(ROOT);
    const violations = [];
    for (const file of files) {
      const relative = path.relative(ROOT, file).replaceAll('\\', '/');
      const content = await readFile(file, 'utf8');
      for (const [pkg, allowedDomains] of Object.entries(RESTRICTED_PACKAGES)) {
        const mentionsPackage = content.includes(`'${pkg}'`) || content.includes(`"${pkg}"`);
        if (!mentionsPackage) continue;
        const inAllowedDomain = allowedDomains.some((domain) => relative.startsWith(`${domain}/`));
        if (!inAllowedDomain) violations.push(`${relative} imports ${pkg} outside [${allowedDomains.join(',')}]`);
      }
    }
    expect(violations).toEqual([]);
  });
});

describe('architecture: home and mail provider adapters are only reachable through their service', () => {
  it('finds no import of a mail adapter file outside mail-service.mjs, mail-sync-service.mjs, and mail itself', { timeout: 30_000 }, async () => {
    const files = await walk(ROOT);
    const violations = [];
    for (const file of files) {
      const relative = path.relative(ROOT, file).replaceAll('\\', '/');
      if (relative.startsWith('mail/')) continue;
      const content = await readFile(file, 'utf8');
      if (/from ['"].*\/mail\/adapters\//u.test(content)) violations.push(relative);
    }
    expect(violations).toEqual([]);
  });

  it('finds no import of a home connector adapter file outside the home domain itself', { timeout: 30_000 }, async () => {
    const files = await walk(ROOT);
    const violations = [];
    for (const file of files) {
      const relative = path.relative(ROOT, file).replaceAll('\\', '/');
      if (relative.startsWith('home/')) continue;
      const content = await readFile(file, 'utf8');
      if (/from ['"].*\/home\/adapters\//u.test(content)) violations.push(relative);
    }
    expect(violations).toEqual([]);
  });
});

describe('architecture: no renderer-side file reaches network, filesystem, or secrets directly', () => {
  it('the renderer script never imports Node built-ins or third-party network/filesystem/crypto packages', { timeout: 30_000 }, async () => {
    const rendererFile = path.join(ROOT, 'ui/renderer.js');
    const content = await readFile(rendererFile, 'utf8');
    const forbidden = ['node:fs', 'node:net', 'node:http', 'node:https', 'node:crypto', "require(", 'process.env'];
    const found = forbidden.filter((token) => content.includes(token));
    expect(found).toEqual([]);
  });
});
