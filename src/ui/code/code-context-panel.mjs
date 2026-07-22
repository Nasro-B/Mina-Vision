// Panneau de contexte projet : framework détecté, fichiers de gouvernance présents,
// état de l'index (fichiers/symboles/date) et racine analysée.

import { createDomKit } from './dom-kit.mjs';

export function createCodeContextPanel({ container, documentRef } = {}) {
  if (!container) throw new TypeError('code_context_panel_container_required');
  const dom = createDomKit(documentRef);

  const row = (label, value) => dom.el('div', { className: 'code-context-row' }, [
    dom.el('b', { text: label }),
    dom.el('span', { text: value }),
  ]);

  return Object.freeze({
    render({ projectRoot = null, projectContext = null, indexStatus = null } = {}) {
      dom.clear(container);
      if (!projectContext && !indexStatus) {
        container.appendChild(dom.el('p', { className: 'code-empty', text: 'Projet non analysé. « Mina, analyse le projet ».' }));
        return;
      }
      if (projectRoot) container.appendChild(row('Racine', projectRoot));
      if (projectContext) {
        container.appendChild(row('Framework', projectContext.framework ?? 'non détecté'));
        const governance = ['minaMd', 'agentsMd', 'claudeMd']
          .filter((key) => typeof projectContext[key] === 'string' && projectContext[key].length > 0)
          .map((key) => ({ minaMd: 'MINA.md', agentsMd: 'AGENTS.md', claudeMd: 'CLAUDE.md' }[key]));
        container.appendChild(row('Gouvernance', governance.length > 0 ? governance.join(', ') : 'aucun fichier de règles'));
        const scripts = Object.keys(projectContext.scripts ?? {});
        if (scripts.length > 0) container.appendChild(row('Scripts npm', scripts.join(', ')));
      }
      if (indexStatus) {
        container.appendChild(row('Index', `${indexStatus.indexedFiles ?? 0} fichier(s), ${indexStatus.symbols ?? 0} symbole(s)`));
        container.appendChild(row('Dernière indexation', indexStatus.lastIndexedAt ?? 'jamais'));
      }
    },
  });
}
