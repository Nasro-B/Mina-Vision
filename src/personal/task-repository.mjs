export function createTaskRepository({ repository } = {}) {
  if (!repository?.put || !repository?.get || !repository?.list) {
    throw new TypeError('task_repository_backing_store_required');
  }

  return Object.freeze({
    async put(task) {
      await repository.put(task.taskId, task);
      return task;
    },

    async get(taskId) {
      return (await repository.get(taskId)) ?? null;
    },

    async list() {
      return Object.freeze(await repository.list());
    },
  });
}
