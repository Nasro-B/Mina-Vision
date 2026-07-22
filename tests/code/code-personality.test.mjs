import { describe, expect, it } from 'vitest';
import { createCodePersonality } from '../../src/code/code-personality.mjs';

describe('code-personality', () => {
  it('construit un prompt système avec les 10 règles absolues numérotées', () => {
    const personality = createCodePersonality();
    const prompt = personality.buildSystemPrompt();
    expect(prompt).toContain('Tu es Mina Code');
    for (let index = 1; index <= 10; index += 1) {
      expect(prompt).toContain(`${index}. `);
    }
    expect(prompt).toContain('git push');
    expect(prompt).toContain('type(scope): message');
  });

  it('référence MINA.md (le vrai fichier de règles), pas seulement AGENTS.md/CLAUDE.md', () => {
    const prompt = createCodePersonality().buildSystemPrompt();
    expect(prompt).toContain('MINA.md');
  });

  it('injecte les instructions de base et le mode fournisseur', () => {
    const personality = createCodePersonality({ baseInstructions: 'Instructions socle Mina.' });
    const prompt = personality.buildSystemPrompt({ mode: 'local-only' });
    expect(prompt).toContain('Instructions socle Mina.');
    expect(prompt).toContain('Mode fournisseur : local-only.');
  });

  it('rejette un mode inconnu', () => {
    expect(() => createCodePersonality().buildSystemPrompt({ mode: 'yolo' }))
      .toThrow(/code_personality_mode_invalid/u);
  });

  it('décrit le contexte projet : framework, scripts et contenu MINA.md/AGENTS.md', () => {
    const prompt = createCodePersonality().buildSystemPrompt({
      projectContext: {
        framework: 'Electron',
        scripts: { test: 'vitest run', start: 'electron .' },
        minaMd: 'Règle locale : sécurité immuable.',
        agentsMd: 'Node 22 obligatoire.',
      },
    });
    expect(prompt).toContain('Framework principal : Electron');
    expect(prompt).toContain('Scripts npm : test, start');
    expect(prompt).toContain('Règle locale : sécurité immuable.');
    expect(prompt).toContain('Node 22 obligatoire.');
  });

  it('affiche le plan actif avec les marqueurs de statut', () => {
    const prompt = createCodePersonality().buildSystemPrompt({
      plan: {
        title: 'JWT refresh',
        steps: [
          { description: 'Test rouge', status: 'completed' },
          { description: 'Code minimal', status: 'in_progress' },
          { description: 'Docs', status: 'pending' },
        ],
      },
    });
    expect(prompt).toContain('Plan actif : JWT refresh');
    expect(prompt).toContain('[x] 1. Test rouge');
    expect(prompt).toContain('[>] 2. Code minimal');
    expect(prompt).toContain('[ ] 3. Docs');
  });

  it('updateWithResult ajoute le résultat d\'action et tronque les observations géantes', () => {
    const personality = createCodePersonality();
    const base = personality.buildSystemPrompt();
    const next = personality.updateWithResult({
      currentPrompt: base,
      actionResult: { action: 'code.write', success: false, error: 'ast_invalid' },
      observation: 'x'.repeat(5_000),
    });
    expect(next).toContain('Dernière action (code.write) : échec — ast_invalid');
    expect(next).toContain('…[tronqué]');
    expect(next.length).toBeLessThan(base.length + 3_000);
  });

  it('compact préserve toujours les règles absolues et respecte le budget', () => {
    const personality = createCodePersonality();
    const base = personality.buildSystemPrompt();
    const bloated = `${base}\n\n${'historique '.repeat(20_000)}`;
    const compacted = personality.compact({ prompt: bloated, maxTokens: 2_000 });
    expect(compacted).toContain('Tu es Mina Code');
    expect(compacted).toContain('…[contexte compacté]…');
    expect(Math.ceil(compacted.length / 4)).toBeLessThanOrEqual(2_100);
  });

  it('compact rend le prompt inchangé s\'il tient déjà dans le budget', () => {
    const personality = createCodePersonality();
    const prompt = personality.buildSystemPrompt();
    expect(personality.compact({ prompt, maxTokens: 100_000 })).toBe(prompt);
  });

  it('exige un prompt non vide pour updateWithResult et compact', () => {
    const personality = createCodePersonality();
    expect(() => personality.updateWithResult({ currentPrompt: '' })).toThrow(/code_personality_prompt_required/u);
    expect(() => personality.compact({ prompt: 'x', maxTokens: 0 })).toThrow(/code_personality_max_tokens_invalid/u);
  });
});
