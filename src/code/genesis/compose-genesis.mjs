import { normalizeProjectBrief, describeBrief } from './project-brief.mjs';
import { getStack, closestStack } from './stack-catalog.mjs';
import { createProjectScaffolder } from './project-scaffolder.mjs';

// Genèse T1.4 (SPEC agente-codage V1) : assemble les 3 modules genèse en un point d'entrée cohérent.
// `prepare` normalise le brief et RÉSOUT la stack (celle demandée si connue, sinon la plus proche, jamais
// inventée) SANS rien écrire — pour montrer le plan à Nasro d'abord (voix + UI). `create` écrit et prouve
// (après confirmation du brief). La boucle « genèse → fonctionnalités » N'A PAS de nouveau moteur : une
// fois le projet créé et vert, l'implémentation fonctionnalité par fonctionnalité (TDD) est confiée au
// code-orchestrator EXISTANT — la genèse ne fait que préparer le terrain. Injectable → testable.

export function composeGenesis({ fs, runCommand, confirm, allowedRoots = [], now } = {}) {
  const scaffolder = createProjectScaffolder({ fs, runCommand, confirm, now });

  function prepare(rawBrief) {
    const brief = normalizeProjectBrief(rawBrief, { allowedRoots });
    const explicit = Boolean(brief.stack && getStack(brief.stack));
    const resolution = explicit
      ? Object.freeze({ suggestion: brief.stack, reason: 'stack demandée et connue', explicit: true })
      : Object.freeze({ ...closestStack(brief.stack ?? brief.type ?? brief.name), explicit: false });
    return Object.freeze({
      brief,
      stack: getStack(resolution.suggestion),
      stackResolution: resolution,
      description: describeBrief(brief),
    });
  }

  return Object.freeze({
    prepare,
    async create(rawBrief) {
      const plan = prepare(rawBrief);
      const result = await scaffolder.scaffold({ brief: plan.brief, stack: plan.stack });
      // `nextStep` rappelle explicitement que les fonctionnalités passent par le code-orchestrator existant.
      return Object.freeze({ ...result, stackResolution: plan.stackResolution, nextStep: 'code-orchestrator (TDD par fonctionnalité)' });
    },
  });
}
