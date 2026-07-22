// Plan board : le plan de code VISIBLE (spec §7.2) — titre, progression, étapes cochées,
// dernier résultat de test, fichiers modifiés. Rendu 100 % DOM sûr, aucune chaîne HTML.

import { createDomKit } from './dom-kit.mjs';

const STEP_MARKS = Object.freeze({
  completed: '[x]',
  in_progress: '[>]',
  failed: '[!]',
  skipped: '[~]',
  pending: '[ ]',
});

const STATUS_LABELS = Object.freeze({
  draft: 'brouillon',
  approved: 'validé',
  in_progress: 'en cours',
  completed: 'terminé',
  aborted: 'abandonné',
});

export function createCodePlanBoard({ container, documentRef } = {}) {
  if (!container) throw new TypeError('code_plan_board_container_required');
  const dom = createDomKit(documentRef);

  return Object.freeze({
    render({ plan = null, lastTest = null, filesChanged = 0 } = {}) {
      dom.clear(container);
      if (!plan) {
        container.appendChild(dom.el('p', { className: 'code-empty', text: 'Aucun plan actif. « Mina, planifie… » pour en créer un.' }));
        return;
      }
      const done = plan.steps.filter((step) => ['completed', 'skipped'].includes(step.status)).length;
      container.appendChild(dom.el('div', { className: 'code-plan-head' }, [
        dom.el('h3', { text: `Plan : ${plan.title}` }),
        dom.el('p', {
          className: `code-plan-status is-${plan.status}`,
          text: `Statut : ${STATUS_LABELS[plan.status] ?? plan.status} (${done}/${plan.steps.length} étapes)`,
        }),
      ]));
      const list = dom.el('ol', { className: 'code-plan-steps' });
      plan.steps.forEach((step, index) => {
        list.appendChild(dom.el('li', { className: `code-plan-step is-${step.status}` }, [
          dom.el('span', { className: 'code-plan-mark', text: STEP_MARKS[step.status] ?? '[ ]' }),
          dom.el('span', { className: 'code-plan-desc', text: `${index + 1}. ${step.description}` }),
          step.files?.length > 0
            ? dom.el('span', { className: 'code-plan-files', text: `[${step.files.join(', ')}]` })
            : null,
        ]));
      });
      container.appendChild(list);
      const footer = dom.el('div', { className: 'code-plan-footer' }, [
        dom.el('span', {
          className: lastTest && lastTest.failed === 0 ? 'code-tests-ok' : 'code-tests-ko',
          text: lastTest
            ? `Dernier test : ${lastTest.failed === 0 ? '[OK]' : '[ROUGE]'} ${lastTest.passed} passed, ${lastTest.failed} failed`
            : 'Dernier test : —',
        }),
        dom.el('span', { text: `Fichiers modifiés : ${filesChanged}` }),
      ]);
      container.appendChild(footer);
    },
  });
}
