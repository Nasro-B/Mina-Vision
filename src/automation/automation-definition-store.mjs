import { randomUUID } from 'node:crypto';
import { NEXT, validateAutomationDefinition } from './automation-contracts.mjs';

export function createAutomationDefinitionStore({ repository, clock } = {}) {
  if (!repository?.put || !repository?.get || !repository?.list) {
    throw new TypeError('automation_definition_store_repository_required');
  }
  if (!clock || (typeof clock !== 'function' && typeof clock.now !== 'function')) {
    throw new TypeError('automation_definition_store_clock_required');
  }
  const now = () => Number(typeof clock === 'function' ? clock() : clock.now());

  async function transition(automationId, nextStatus, { expectedVersion } = {}) {
    const current = await repository.get(automationId);
    if (!current) throw new Error('automation_definition_not_found');
    if (expectedVersion !== undefined && expectedVersion !== current.version) {
      throw new Error('automation_definition_version_stale');
    }
    if (!NEXT[current.status]?.has(nextStatus)) {
      throw new Error('invalid_automation_transition');
    }
    const record = Object.freeze({
      ...current,
      status: nextStatus,
      previousStatus: current.status,
      version: current.version + 1,
      changedAt: new Date(now()).toISOString(),
    });
    await repository.put(automationId, record);
    return record;
  }

  return Object.freeze({
    async create(input) {
      const parsed = validateAutomationDefinition(input);
      if (parsed.status !== 'draft') {
        throw new Error('automation_definition_must_start_draft');
      }
      const createdAt = new Date(now()).toISOString();
      const record = Object.freeze({
        automationId: randomUUID(),
        name: parsed.name,
        description: parsed.description,
        allowedActions: parsed.allowedActions,
        status: 'draft',
        version: 1,
        previousStatus: null,
        createdAt,
        changedAt: createdAt,
      });
      await repository.put(record.automationId, record);
      return record;
    },

    async get(automationId) {
      const record = await repository.get(automationId);
      return record ?? null;
    },

    async list() {
      return Object.freeze(await repository.list());
    },

    transition,

    revoke(automationId, options = {}) {
      return transition(automationId, 'revoked', options);
    },
  });
}
