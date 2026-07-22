// Visionneuse de diff : texte unifié rendu ligne par ligne (classe par type +/-/@@), en
// textContent strict — le contenu du diff n'est JAMAIS interprété comme du HTML.

import { createDomKit } from './dom-kit.mjs';

const MAX_LINES = 2_000;

const lineClass = (line) => {
  if (line.startsWith('+++') || line.startsWith('---')) return 'code-diff-file';
  if (line.startsWith('@@')) return 'code-diff-hunk';
  if (line.startsWith('+')) return 'code-diff-add';
  if (line.startsWith('-')) return 'code-diff-del';
  return 'code-diff-ctx';
};

export function createCodeDiffViewer({ container, documentRef } = {}) {
  if (!container) throw new TypeError('code_diff_viewer_container_required');
  const dom = createDomKit(documentRef);

  return Object.freeze({
    render({ diffText = '', title = null } = {}) {
      dom.clear(container);
      if (title) container.appendChild(dom.el('h3', { text: title }));
      const text = String(diffText ?? '');
      if (text.trim() === '') {
        container.appendChild(dom.el('p', { className: 'code-empty', text: 'Aucun diff à afficher.' }));
        return;
      }
      const pre = dom.el('pre', { className: 'code-diff' });
      const lines = text.split('\n');
      const shown = lines.slice(0, MAX_LINES);
      for (const line of shown) {
        pre.appendChild(dom.el('span', { className: `code-diff-line ${lineClass(line)}`, text: `${line}\n` }));
      }
      if (lines.length > MAX_LINES) {
        pre.appendChild(dom.el('span', { className: 'code-diff-truncated', text: `… ${lines.length - MAX_LINES} ligne(s) tronquée(s)` }));
      }
      container.appendChild(pre);
    },
  });
}
