import { randomUUID } from 'node:crypto';
import { validateRoutineInput } from './routine-contracts.mjs';

export function createRoutineRegistry({ repository, clock } = {}) {
  if (!repository?.put || !repository?.get || !repository?.list) {
    throw new TypeError('routine_registry_repository_required');
  }
  if (!clock || (typeof clock !== 'function' && typeof clock.now !== 'function')) {
    throw new TypeError('routine_registry_clock_required');
  }
  const now = () => Number(typeof clock === 'function' ? clock() : clock.now());

  return Object.freeze({
    async createRoutine(input) {
      const parsed = validateRoutineInput(input);
      const record = Object.freeze({
        routineId: randomUUID(), ...parsed, version: 1, createdAt: new Date(now()).toISOString(),
      });
      await repository.put(record.routineId, record);
      return record;
    },

    async getRoutine(routineId) {
      return (await repository.get(routineId)) ?? null;
    },

    async listRoutines() {
      return Object.freeze(await repository.list());
    },

    async setStatus(routineId, status) {
      const current = await repository.get(routineId);
      if (!current) throw new Error('routine_not_found');
      const updated = Object.freeze({ ...current, status, version: current.version + 1 });
      await repository.put(routineId, updated);
      return updated;
    },
  });
}
