import { randomUUID } from 'node:crypto';
import { validateAutomationGrant } from './automation-contracts.mjs';

export function createAutomationGrantStore({ repository, clock } = {}) {
  if (!repository?.put || !repository?.get || !repository?.list) {
    throw new TypeError('automation_grant_store_repository_required');
  }
  if (!clock || (typeof clock !== 'function' && typeof clock.now !== 'function')) {
    throw new TypeError('automation_grant_store_clock_required');
  }
  const now = () => Number(typeof clock === 'function' ? clock() : clock.now());

  return Object.freeze({
    async create(input) {
      const parsed = validateAutomationGrant(input);
      const record = Object.freeze({
        grantId: randomUUID(),
        ...parsed,
        createdAt: new Date(now()).toISOString(),
      });
      await repository.put(record.grantId, record);
      return record;
    },

    async get(grantId) {
      return (await repository.get(grantId)) ?? null;
    },

    async listByAutomation(automationId) {
      const all = await repository.list();
      return Object.freeze(all.filter((grant) => grant.automationId === automationId));
    },
  });
}
