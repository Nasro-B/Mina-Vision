import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '..');

describe('Mina launcher', () => {
  it('bootstraps the Electron binary without embedding credentials', () => {
    const source = fs.readFileSync(path.join(root, 'scripts', 'launch-mina.ps1'), 'utf8');

    expect(source).toContain("node_modules\\electron\\install.js");
    expect(source).toContain('electron.exe');
    expect(source).not.toMatch(/GEMINI_API_KEY\s*=|OPENROUTER_API_KEY\s*=|MODAL_TOKEN\s*=/);
  });
});
