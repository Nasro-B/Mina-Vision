// Terminal de sortie Mina Code : journal borné des étapes (info/succès/erreur), défilement
// géré par l'appelant. Texte brut uniquement.

import { createDomKit } from './dom-kit.mjs';

const DEFAULT_MAX_LINES = 400;
const KINDS = new Set(['info', 'ok', 'err', 'cmd']);

export function createCodeTerminal({ container, documentRef, maxLines = DEFAULT_MAX_LINES } = {}) {
  if (!container) throw new TypeError('code_terminal_container_required');
  const dom = createDomKit(documentRef);
  const bounded = Math.min(Math.max(50, Number(maxLines) || DEFAULT_MAX_LINES), 5_000);

  return Object.freeze({
    append(line, kind = 'info') {
      const safeKind = KINDS.has(kind) ? kind : 'info';
      container.appendChild(dom.el('div', {
        className: `code-terminal-line is-${safeKind}`,
        text: String(line ?? '').slice(0, 2_000),
      }));
      while (container.children.length > bounded) {
        container.removeChild(container.firstChild);
      }
    },

    clear() {
      dom.clear(container);
    },

    lineCount: () => container.children.length,
  });
}
