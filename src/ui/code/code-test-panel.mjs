// Panneau de tests : compteurs verts/rouges/ignorés, durée, liste bornée des échecs.

import { createDomKit } from './dom-kit.mjs';

const MAX_FAILURES = 20;

export function createCodeTestPanel({ container, documentRef } = {}) {
  if (!container) throw new TypeError('code_test_panel_container_required');
  const dom = createDomKit(documentRef);

  return Object.freeze({
    render({ result = null } = {}) {
      dom.clear(container);
      if (!result) {
        container.appendChild(dom.el('p', { className: 'code-empty', text: 'Aucune exécution de tests pour l\'instant.' }));
        return;
      }
      const ok = result.failed === 0 && !result.crashed;
      container.appendChild(dom.el('div', { className: `code-test-summary ${ok ? 'is-ok' : 'is-ko'}` }, [
        dom.el('strong', { text: ok ? 'SUITE VERTE' : result.crashed ? 'LANCEUR EN ÉCHEC' : 'SUITE ROUGE' }),
        dom.el('span', { text: ` ${result.passed ?? 0} verts · ${result.failed ?? 0} rouges · ${result.skipped ?? 0} ignorés` }),
        result.duration ? dom.el('span', { text: ` · ${(result.duration / 1_000).toFixed(1)} s` }) : null,
        result.framework ? dom.el('span', { className: 'code-test-framework', text: ` (${result.framework})` }) : null,
      ]));
      const failures = (result.failures ?? []).slice(0, MAX_FAILURES);
      if (failures.length > 0) {
        const list = dom.el('ul', { className: 'code-test-failures' });
        for (const failure of failures) {
          list.appendChild(dom.el('li', { text: failure }));
        }
        container.appendChild(list);
      }
    },
  });
}
