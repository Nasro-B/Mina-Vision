import { describe, expect, it } from 'vitest';
import { createCodeContextWindow, estimateTokens } from '../../src/code/code-context-window.mjs';

describe('code-context-window', () => {
  it('estime les tokens à ~4 caractères par token', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcdefgh')).toBe(2);
    expect(estimateTokens('')).toBe(0);
  });

  it('valide maxTokens et la réserve de réponse', () => {
    expect(() => createCodeContextWindow({ maxTokens: 0 })).toThrow(/code_context_max_tokens_invalid/u);
    expect(() => createCodeContextWindow({ maxTokens: 100, reservedForResponse: 100 })).toThrow(/code_context_reserve_invalid/u);
  });

  it('additionne fichiers, actions et échecs de test dans le total', () => {
    const window = createCodeContextWindow({ maxTokens: 1_000, reservedForResponse: 100 });
    window.addFile({ path: 'a.mjs', content: 'x'.repeat(400) });
    window.addActionResult({ action: 'code.read', result: { success: true } });
    window.addTestFailure({ test: 'a.test.mjs', error: 'boom' });
    expect(window.estimateTokens()).toBeGreaterThan(100);
    expect(window.snapshot().files).toHaveLength(1);
  });

  it('évince d\'abord les fichiers non épinglés à faible pertinence', () => {
    const window = createCodeContextWindow({ maxTokens: 300, reservedForResponse: 50 });
    window.addFile({ path: 'faible.mjs', content: 'x'.repeat(600), relevance: 0.1 });
    window.addFile({ path: 'fort.mjs', content: 'y'.repeat(400), relevance: 0.9 });
    const evicted = window.evict({ targetTokens: 150 });
    expect(evicted).toContain('file:faible.mjs');
    expect(window.snapshot().files.map((file) => file.path)).toContain('fort.mjs');
  });

  it('n\'évince JAMAIS un fichier épinglé, même en dernier recours', () => {
    const window = createCodeContextWindow({ maxTokens: 200, reservedForResponse: 50 });
    window.addFile({ path: 'MINA.md', content: 'règles '.repeat(200), relevance: 0.1 });
    window.pinFiles(['MINA.md']);
    const evicted = window.evict({ targetTokens: 10 });
    expect(evicted).not.toContain('file:MINA.md');
    expect(window.snapshot().files.map((file) => file.path)).toContain('MINA.md');
  });

  it('évince les actions anciennes (> 10 cycles) mais garde les récentes', () => {
    const window = createCodeContextWindow({ maxTokens: 10_000, reservedForResponse: 100 });
    for (let index = 0; index < 15; index += 1) {
      window.addActionResult({ action: `action-${index}`, result: { success: true }, observation: 'o'.repeat(200) });
    }
    window.evict({ targetTokens: 300 });
    const summary = window.summarizeHistory();
    expect(summary).toContain('action-14');
    expect(summary).not.toContain('action-0 ');
  });

  it('garde toujours le DERNIER échec de test lors d\'une éviction', () => {
    const window = createCodeContextWindow({ maxTokens: 10_000, reservedForResponse: 100 });
    for (let index = 0; index < 12; index += 1) {
      window.addActionResult({ action: `a${index}` });
      window.addTestFailure({ test: `t${index}`, error: 'e'.repeat(300) });
    }
    window.evict({ targetTokens: 200 });
    expect(window.summarizeHistory()).toContain('t11');
  });

  it('compact ne fait rien sous le budget et rapporte les évictions au-dessus', () => {
    const small = createCodeContextWindow({ maxTokens: 200, reservedForResponse: 50 });
    small.addFile({ path: 'gros.mjs', content: 'z'.repeat(2_000), relevance: 0.1 });
    const report = small.compact();
    expect(report.tokensBefore).toBeGreaterThan(report.budget);
    expect(report.evicted.length).toBeGreaterThan(0);
    expect(report.tokensAfter).toBeLessThanOrEqual(report.budget);

    const large = createCodeContextWindow({ maxTokens: 100_000 });
    large.addFile({ path: 'petit.mjs', content: 'ok' });
    expect(large.compact().evicted).toEqual([]);
  });

  it('réécrit un fichier existant sans perdre son épinglage', () => {
    const window = createCodeContextWindow({ maxTokens: 1_000, reservedForResponse: 100 });
    window.addFile({ path: 'a.mjs', content: 'v1' });
    window.pinFiles(['a.mjs']);
    window.addFile({ path: 'a.mjs', content: 'v2', relevance: 0.2 });
    expect(window.snapshot().files[0]).toMatchObject({ path: 'a.mjs', pinned: true });
  });

  it('valide les entrées : chemin requis, contenu requis, cible d\'éviction finie', () => {
    const window = createCodeContextWindow();
    expect(() => window.addFile({ content: 'x' })).toThrow(/code_context_path_required/u);
    expect(() => window.addFile({ path: 'a' })).toThrow(/code_context_content_required/u);
    expect(() => window.evict({ targetTokens: -1 })).toThrow(/code_context_target_invalid/u);
    expect(() => window.pinFiles('a')).toThrow(/code_context_paths_required/u);
  });
});
