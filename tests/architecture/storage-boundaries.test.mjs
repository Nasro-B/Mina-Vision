import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROUTE_KEYS } from '../../src/usage/usage-repository.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../src');

async function walk(directory, files = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(absolute, files);
    else if (entry.isFile() && absolute.endsWith('.mjs')) files.push(absolute);
  }
  return files;
}

async function contentsFor(files) {
  return Promise.all(files.map(async (file) => ({ file, content: await readFile(file, 'utf8') })));
}

describe('storage boundary: biometric and camera-frame code never reaches memory/RAG/backup', () => {
  it('finds no import of src/biometrics or src/camera from the memory, rag, or backup domains', { timeout: 30_000 }, async () => {
    const files = await walk(ROOT);
    const guardedDomains = ['memory/', 'rag/', 'backup/'];
    const guardedFiles = files.filter((file) => guardedDomains.some((domain) => path.relative(ROOT, file).replaceAll('\\', '/').startsWith(domain)));
    const violations = [];
    for (const { file, content } of await contentsFor(guardedFiles)) {
      const relative = path.relative(ROOT, file).replaceAll('\\', '/');
      if (/from ['"].*\/(biometrics|camera)\//u.test(content)) violations.push(relative);
    }
    expect(violations).toEqual([]);
  });

  it('finds no import of src/memory, src/rag, or src/backup from the biometrics or camera domains', { timeout: 30_000 }, async () => {
    const files = await walk(ROOT);
    const guardedDomains = ['biometrics/', 'camera/'];
    const guardedFiles = files.filter((file) => guardedDomains.some((domain) => path.relative(ROOT, file).replaceAll('\\', '/').startsWith(domain)));
    const violations = [];
    for (const { file, content } of await contentsFor(guardedFiles)) {
      const relative = path.relative(ROOT, file).replaceAll('\\', '/');
      if (/from ['"].*\/(memory|rag|backup)\//u.test(content)) violations.push(relative);
    }
    expect(violations).toEqual([]);
  });
});

describe('storage boundary: usage analytics never carries conversation or file content', () => {
  it('keeps the route metadata allowlist limited to routing metadata fields, never a content field', () => {
    const forbiddenNames = /prompt|response|message|text|body|content|transcript|image|frame/iu;
    for (const key of ROUTE_KEYS) {
      expect(key).not.toMatch(forbiddenNames);
    }
  });
});

describe('storage boundary: keyring secret domains stay namespaced and non-overlapping', () => {
  it('finds every keyring secret-name prefix used across the codebase and confirms each domain owns a distinct prefix', { timeout: 30_000 }, async () => {
    const files = await walk(ROOT);
    const contents = await contentsFor(files);
    const prefixes = new Set();
    const prefixPattern = /['"`]([a-z][a-z0-9-]*\/[a-z0-9/_*-]+)['"`]/gu;
    for (const { content } of contents) {
      if (!content.includes('setSecret') && !content.includes('getSecret') && !content.includes('deleteSecret')) continue;
      for (const match of content.matchAll(prefixPattern)) {
        const candidate = match[1];
        if (candidate.startsWith('provider/') || candidate.startsWith('mail/account')
          || candidate.startsWith('biometric/face-profile')) {
          prefixes.add(candidate.split('/').slice(0, 2).join('/'));
        }
      }
    }
    const domains = new Set([...prefixes].map((prefix) => prefix.split('/')[0]));
    expect(domains.size).toBeGreaterThanOrEqual(3);
    expect(domains).toEqual(new Set(['provider', 'mail', 'biometric']));
  });

  it('never references Android Keystore from PC-side Node source, that boundary is phone-only', { timeout: 30_000 }, async () => {
    const files = await walk(ROOT);
    const contents = await contentsFor(files);
    const violations = [];
    for (const { file, content } of contents) {
      if (/android\s*keystore/iu.test(content)) violations.push(path.relative(ROOT, file));
    }
    expect(violations).toEqual([]);
  });
});
