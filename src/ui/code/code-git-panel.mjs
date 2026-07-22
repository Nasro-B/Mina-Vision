// Panneau Git : branche courante, compteurs staged/modifiés/non suivis, derniers commits.
// Rappel affiché en permanence : le push n'existe pas dans Mina Code.

import { createDomKit } from './dom-kit.mjs';

const MAX_COMMITS = 10;
const MAX_FILES = 15;

export function createCodeGitPanel({ container, documentRef } = {}) {
  if (!container) throw new TypeError('code_git_panel_container_required');
  const dom = createDomKit(documentRef);

  const fileList = (title, files) => {
    if (!files || files.length === 0) return null;
    return dom.el('div', { className: 'code-git-group' }, [
      dom.el('h4', { text: `${title} (${files.length})` }),
      dom.el('ul', {}, files.slice(0, MAX_FILES).map((file) => dom.el('li', { text: file }))),
    ]);
  };

  return Object.freeze({
    render({ status = null, log = [], notRepository = false } = {}) {
      dom.clear(container);
      if (notRepository) {
        container.appendChild(dom.el('p', { className: 'code-empty', text: 'Ce dossier n\'est pas un dépôt git.' }));
        return;
      }
      if (!status) {
        container.appendChild(dom.el('p', { className: 'code-empty', text: 'Statut git non chargé.' }));
        return;
      }
      container.appendChild(dom.el('div', { className: 'code-git-head' }, [
        dom.el('strong', { text: `Branche : ${status.branch ?? '?'}` }),
        status.upstream ? dom.el('span', { text: ` → ${status.upstream} (+${status.ahead ?? 0}/-${status.behind ?? 0})` }) : null,
        dom.el('span', { className: status.clean ? 'code-git-clean' : 'code-git-dirty', text: status.clean ? ' · arbre propre' : ' · modifications en attente' }),
      ]));
      for (const group of [
        fileList('Indexés (staged)', status.staged),
        fileList('Modifiés', status.modified),
        fileList('Non suivis', status.untracked),
      ]) {
        if (group) container.appendChild(group);
      }
      if (log.length > 0) {
        const list = dom.el('ul', { className: 'code-git-log' });
        for (const entry of log.slice(0, MAX_COMMITS)) {
          list.appendChild(dom.el('li', {}, [
            dom.el('code', { text: entry.shortHash ?? '' }),
            dom.el('span', { text: ` ${entry.subject ?? ''} — ${entry.author ?? ''}` }),
          ]));
        }
        container.appendChild(dom.el('h4', { text: 'Derniers commits' }));
        container.appendChild(list);
      }
      container.appendChild(dom.el('p', { className: 'code-git-reminder', text: 'Le push reste manuel : Mina ne pousse jamais.' }));
    },
  });
}
