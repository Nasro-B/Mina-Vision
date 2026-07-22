import { randomUUID } from 'node:crypto';

export function createTaskService({ repository, hub, capabilityBroker, clock } = {}) {
  if (!repository?.get || !repository?.put) throw new TypeError('task_service_repository_required');
  if (!hub?.adapter) throw new TypeError('task_service_hub_required');
  if (!capabilityBroker?.authorize) throw new TypeError('task_service_capability_broker_required');
  if (!clock || (typeof clock !== 'function' && typeof clock.now !== 'function')) {
    throw new TypeError('task_service_clock_required');
  }
  const now = () => Number(typeof clock === 'function' ? clock() : clock.now());

  async function requireTask(taskId) {
    const task = await repository.get(taskId);
    if (!task) throw new Error('task_not_found');
    return task;
  }

  return Object.freeze({
    async propose({ title, sourceRef = null, dueAt = null, providerId = null }) {
      if (typeof title !== 'string' || title.trim().length === 0) throw new TypeError('task_title_required');
      const task = Object.freeze({
        taskId: randomUUID(), providerId, title, status: 'proposed', dueAt, sourceRef, revision: `local:${now()}`,
      });
      return repository.put(task);
    },

    async activate(taskId) {
      const task = await requireTask(taskId);
      if (task.status !== 'proposed') throw new Error('task_not_proposed');
      const decision = await capabilityBroker.authorize({ capability: 'personal.tasks', effect: 'write', resource: task.sourceRef });
      if (decision.decision !== 'allow') throw new Error(decision.reason ?? 'capability_denied');

      const provider = hub.adapter(task.providerId);
      const receipt = await provider.create({ title: task.title, dueAt: task.dueAt, sourceRef: task.sourceRef });
      const activated = Object.freeze({ ...task, status: 'active', revision: receipt.revision, providerTaskId: receipt.taskId });
      return repository.put(activated);
    },

    async complete(taskId) {
      const task = await requireTask(taskId);
      const completed = Object.freeze({ ...task, status: 'completed' });
      await repository.put(completed);
      if (task.status === 'active' && task.providerId) {
        try {
          await hub.adapter(task.providerId).complete(task.providerTaskId ?? taskId);
        } catch {
          throw new Error('sync_conflict');
        }
      }
      return completed;
    },

    async cancel(taskId) {
      const task = await requireTask(taskId);
      const cancelled = Object.freeze({ ...task, status: 'cancelled' });
      await repository.put(cancelled);
      if (task.status === 'active' && task.providerId) {
        await hub.adapter(task.providerId).cancel(task.providerTaskId ?? taskId);
      }
      return cancelled;
    },

    async sync(providerId) {
      const provider = hub.adapter(providerId);
      const page = await provider.sync({ cursor: null, resource: 'tasks' });
      for (const item of page.items) {
        // eslint-disable-next-line no-await-in-loop
        await repository.put(item);
      }
      return Object.freeze({ synced: page.items.length });
    },
  });
}
