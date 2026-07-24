import { randomUUID } from 'node:crypto';

// Registre de domaines INVOCABLE — la dépendance `domain_registry.invoke/simulate` que la
// simulation (simulation-engine) et l'exécution (automation-runner) attendent, et que le mode
// urgence pilote (`disableExternal`/`restore`). Distinct de src/core/domain-registry.mjs qui ne
// gère que le cycle de vie start/stop des domaines composés.
//
// Principes non négociables :
//   • un handler par PRÉFIXE de capability (`notify` sert `notify:pc`, `notify:telegram`…) ;
//   • simulate() est un DRY-RUN : jamais d'effet de bord — un handler sans simulate propre rend
//     une incertitude honnête au lieu de faire semblant d'avoir prédit ;
//   • invoke() rend un REÇU daté et identifié (l'automation-runner le fait vérifier ensuite) ;
//   • capability inconnue → simulate l'AVOUE (uncertainty), invoke REFUSE (fail-loud) ;
//   • le mode urgence coupe les handlers marqués `external` sans toucher aux locaux.

export function createInvokableDomainRegistry({ clock = () => Date.now(), logger = null } = {}) {
  const handlers = new Map();
  let externalDisabled = false;

  const prefixOf = (capability) => String(capability ?? '').split(':')[0];

  function register(prefix, handler) {
    if (!prefix || typeof prefix !== 'string' || !/^[a-z0-9_.-]{1,80}$/u.test(prefix)) {
      throw new TypeError('domain_registry_prefix_invalid');
    }
    if (typeof handler?.invoke !== 'function') throw new TypeError('domain_registry_handler_invalid');
    if (handlers.has(prefix)) throw new Error('domain_registry_handler_duplicate');
    handlers.set(prefix, Object.freeze({
      invoke: handler.invoke,
      simulate: typeof handler.simulate === 'function' ? handler.simulate : null,
      external: Boolean(handler.external),
      describe: String(handler.describe ?? prefix),
    }));
  }

  async function simulate(action, context = {}) {
    const handler = handlers.get(prefixOf(action?.capability));
    if (!handler) {
      return Object.freeze({ uncertainty: `capability_inconnue:${String(action?.capability ?? '')}` });
    }
    if (externalDisabled && handler.external) {
      return Object.freeze({ uncertainty: `capability_externe_coupee:${String(action.capability)}` });
    }
    if (!handler.simulate) {
      // Pas de simulation dédiée : on le DIT — l'incertitude remonte dans le résumé de simulation
      // au lieu d'une fausse assurance.
      return Object.freeze({ uncertainty: `simulation_indisponible:${String(action.capability)}` });
    }
    return handler.simulate(action, context);
  }

  async function invoke(action) {
    const capability = String(action?.capability ?? '');
    const handler = handlers.get(prefixOf(capability));
    if (!handler) throw new Error(`capability_inconnue:${capability}`);
    if (externalDisabled && handler.external) throw new Error(`capability_externe_coupee:${capability}`);
    const result = await handler.invoke(action);
    const receipt = Object.freeze({
      receiptId: randomUUID(),
      capability,
      actionType: String(action?.actionType ?? ''),
      idempotencyKey: action?.idempotencyKey ?? null,
      at: new Date(Number(clock())).toISOString(),
      effect: result?.effect ?? null,
      detail: result?.detail ?? null,
    });
    logger?.append?.({ event: 'automation_invoke', capability, receiptId: receipt.receiptId });
    return receipt;
  }

  async function disableExternal() {
    externalDisabled = true;
    logger?.append?.({ event: 'automation_externes_coupees' });
    return Object.freeze({ disabled: true });
  }

  async function restore() {
    externalDisabled = false;
    logger?.append?.({ event: 'automation_externes_retablies' });
    return Object.freeze({ disabled: false });
  }

  return Object.freeze({
    register,
    simulate,
    invoke,
    disableExternal,
    restore,
    isExternalDisabled: () => externalDisabled,
    capabilities: () => Object.freeze([...handlers.keys()]),
  });
}
