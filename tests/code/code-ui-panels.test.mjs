import { describe, expect, it } from 'vitest';
import { createDomKit } from '../../src/ui/code/dom-kit.mjs';
import { createCodePlanBoard } from '../../src/ui/code/code-plan-board.mjs';
import { createCodeDiffViewer } from '../../src/ui/code/code-diff-viewer.mjs';
import { createCodeTestPanel } from '../../src/ui/code/code-test-panel.mjs';
import { createCodeGitPanel } from '../../src/ui/code/code-git-panel.mjs';
import { createCodeContextPanel } from '../../src/ui/code/code-context-panel.mjs';
import { createCodeTerminal } from '../../src/ui/code/code-terminal.mjs';

// Faux DOM minimal : couvre createElement/textContent/appendChild/removeChild/replaceChildren/
// setAttribute — suffisant car les panneaux n'utilisent QUE ces méthodes (contrat zéro innerHTML).
function createFakeDocument() {
  function makeElement(tag) {
    const node = {
      tag,
      className: '',
      textContent: '',
      attributes: {},
      children: [],
      get firstChild() { return node.children[0] ?? null; },
      appendChild(child) {
        if (!child || typeof child !== 'object') throw new TypeError(`appendChild invalide sur <${tag}>`);
        node.children.push(child);
        return child;
      },
      removeChild(child) {
        const index = node.children.indexOf(child);
        if (index === -1) throw new Error('removeChild: enfant inconnu');
        node.children.splice(index, 1);
      },
      replaceChildren() { node.children.length = 0; },
      setAttribute(key, value) { node.attributes[key] = value; },
    };
    return node;
  }
  return { createElement: makeElement, makeElement };
}

const allText = (node) => [node.textContent, ...node.children.map(allText)].join(' ');

function setup() {
  const documentRef = createFakeDocument();
  const container = documentRef.makeElement('div');
  return { documentRef, container };
}

describe('dom-kit', () => {
  it('exige un document et construit des éléments texte sûrs', () => {
    expect(() => createDomKit(null)).toThrow(/code_ui_document_required/u);
    const { documentRef } = setup();
    const dom = createDomKit(documentRef);
    const node = dom.el('span', { className: 'x', text: '<script>alert(1)</script>' });
    // La charge reste du TEXTE (textContent), jamais interprétée.
    expect(node.textContent).toBe('<script>alert(1)</script>');
    expect(node.children).toHaveLength(0);
  });
});

describe('code-plan-board', () => {
  it('état vide → message d\'invite', () => {
    const { documentRef, container } = setup();
    createCodePlanBoard({ container, documentRef }).render({});
    expect(allText(container)).toContain('Aucun plan actif');
  });

  it('rend titre, progression, marqueurs d\'étapes et pied de page tests/fichiers', () => {
    const { documentRef, container } = setup();
    createCodePlanBoard({ container, documentRef }).render({
      plan: {
        title: 'JWT',
        status: 'in_progress',
        steps: [
          { description: 'test rouge', status: 'completed', files: ['tests/a'] },
          { description: 'code minimal', status: 'in_progress', files: [] },
          { description: 'docs', status: 'pending', files: [] },
        ],
      },
      lastTest: { passed: 42, failed: 0 },
      filesChanged: 3,
    });
    const text = allText(container);
    expect(text).toContain('Plan : JWT');
    expect(text).toContain('(1/3 étapes)');
    expect(text).toContain('[x]');
    expect(text).toContain('[>]');
    expect(text).toContain('[OK] 42 passed, 0 failed');
    expect(text).toContain('Fichiers modifiés : 3');
    expect(text).toContain('[tests/a]');
  });

  it('re-render remplace le contenu précédent', () => {
    const { documentRef, container } = setup();
    const board = createCodePlanBoard({ container, documentRef });
    board.render({ plan: { title: 'A', status: 'draft', steps: [{ description: 'x', status: 'pending' }] } });
    board.render({});
    expect(allText(container)).not.toContain('Plan : A');
  });
});

describe('code-diff-viewer', () => {
  it('classe chaque ligne par type et garde le texte brut', () => {
    const { documentRef, container } = setup();
    createCodeDiffViewer({ container, documentRef }).render({
      diffText: '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-vieux\n+neuf <b>pas du html</b>\n contexte',
      title: 'Diff courant',
    });
    const pre = container.children.find((child) => child.tag === 'pre');
    const classes = pre.children.map((child) => child.className);
    expect(classes[0]).toContain('code-diff-file');
    expect(classes[2]).toContain('code-diff-hunk');
    expect(classes[3]).toContain('code-diff-del');
    expect(classes[4]).toContain('code-diff-add');
    expect(pre.children[4].textContent).toContain('<b>pas du html</b>');
  });

  it('diff vide → message, diff géant → tronqué avec compteur', () => {
    const { documentRef, container } = setup();
    const viewer = createCodeDiffViewer({ container, documentRef });
    viewer.render({ diffText: '  ' });
    expect(allText(container)).toContain('Aucun diff');
    viewer.render({ diffText: Array(2_500).fill('+x').join('\n') });
    expect(allText(container)).toContain('500 ligne(s) tronquée(s)');
  });
});

describe('code-test-panel', () => {
  it('suite verte / rouge / crash avec compteurs et échecs bornés', () => {
    const { documentRef, container } = setup();
    const panel = createCodeTestPanel({ container, documentRef });
    panel.render({ result: { passed: 10, failed: 0, skipped: 1, duration: 2_000, framework: 'vitest', failures: [] } });
    expect(allText(container)).toContain('SUITE VERTE');
    expect(allText(container)).toContain('2.0 s');

    panel.render({ result: { passed: 8, failed: 2, failures: ['tests/a.test.mjs', 'tests/b.test.mjs'] } });
    const text = allText(container);
    expect(text).toContain('SUITE ROUGE');
    expect(text).toContain('tests/a.test.mjs');

    panel.render({ result: { passed: 0, failed: 0, crashed: true, failures: [] } });
    expect(allText(container)).toContain('LANCEUR EN ÉCHEC');
  });
});

describe('code-git-panel', () => {
  it('hors dépôt → message dédié ; dépôt → branche, groupes, commits, rappel anti-push', () => {
    const { documentRef, container } = setup();
    const panel = createCodeGitPanel({ container, documentRef });
    panel.render({ notRepository: true });
    expect(allText(container)).toContain('pas un dépôt git');

    panel.render({
      status: { branch: 'main', upstream: 'origin/main', ahead: 1, behind: 0, staged: ['a.mjs'], modified: [], untracked: ['b.txt'], clean: false },
      log: [{ shortHash: 'abc1234', subject: 'feat: x', author: 'Nasro' }],
    });
    const text = allText(container);
    expect(text).toContain('Branche : main');
    expect(text).toContain('Indexés (staged) (1)');
    expect(text).toContain('Non suivis (1)');
    expect(text).toContain('abc1234');
    expect(text).toContain('Mina ne pousse jamais');
  });
});

describe('code-context-panel', () => {
  it('affiche racine, framework, gouvernance (MINA.md inclus) et index', () => {
    const { documentRef, container } = setup();
    createCodeContextPanel({ container, documentRef }).render({
      projectRoot: 'C:/p',
      projectContext: { framework: 'Electron', minaMd: '# règles', scripts: { test: 'vitest' } },
      indexStatus: { indexedFiles: 12, symbols: 80, lastIndexedAt: '2026-07-20T10:00:00Z' },
    });
    const text = allText(container);
    expect(text).toContain('Electron');
    expect(text).toContain('MINA.md');
    expect(text).toContain('12 fichier(s), 80 symbole(s)');
  });
});

describe('code-terminal', () => {
  it('ajoute des lignes typées, borne le tampon, clear vide tout', () => {
    const { documentRef, container } = setup();
    const terminal = createCodeTerminal({ container, documentRef, maxLines: 50 });
    for (let index = 0; index < 60; index += 1) terminal.append(`ligne ${index}`, index % 2 ? 'ok' : 'err');
    expect(terminal.lineCount()).toBe(50);
    expect(allText(container)).not.toContain('ligne 0 ');
    expect(allText(container)).toContain('ligne 59');
    expect(container.children[0].className).toContain('is-');
    terminal.append('kind inconnu', 'zzz');
    expect(container.children[container.children.length - 1].className).toContain('is-info');
    terminal.clear();
    expect(terminal.lineCount()).toBe(0);
  });
});
