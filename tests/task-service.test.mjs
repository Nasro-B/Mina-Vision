import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createTaskRepository } from '../src/personal/task-repository.mjs';
import { createTaskService } from '../src/personal/task-service.mjs';

function fakeBackingRepo() {
  const rows = new Map();
  return {
    async put(id, record) { rows.set(id, record); },
    async get(id) { return rows.get(id) ?? null; },
    async list() { return [...rows.values()]; },
  };
}

function fakeProvider(overrides = {}) {
  return {
    capabilities: Object.freeze(['sync', 'create', 'complete', 'cancel']),
    create: vi.fn(async (input) => ({ taskId: `provider-${randomUUID()}`, revision: 'r1' })),
    complete: vi.fn(async () => ({ revision: 'r2' })),
    cancel: vi.fn(async () => ({ revision: 'r2' })),
    sync: vi.fn(async () => ({ items: [], removedIds: [], cursor: null, hasMore: false })),
    ...overrides,
  };
}

function buildService(overrides = {}) {
  const repo = createTaskRepository({ repository: fakeBackingRepo() });
  const provider = fakeProvider();
  const capabilityBroker = { authorize: vi.fn(async () => ({ decision: 'allow', reason: 'ok' })) };
  const service = createTaskService({
    repository: repo, hub: { adapter: vi.fn(() => provider) }, capabilityBroker, clock: () => 1_700_000_000_000, ...overrides,
  });
  return { repo, provider, service, capabilityBroker };
}

describe('createTaskService: constructor guards', () => {
  it('requires a repository', () => {
    expect(() => createTaskService({ hub: { adapter: vi.fn() }, capabilityBroker: { authorize: vi.fn() }, clock: () => 0 }))
      .toThrow('task_service_repository_required');
  });
});

describe('createTaskService.propose: local-only, never touches a provider', () => {
  it('creates a proposed task without calling the provider', async () => {
    const { service, provider } = buildService();
    const task = await service.propose({ title: 'Rappeler Alice', sourceRef: 'mail:m1' });
    expect(task.status).toBe('proposed');
    expect(provider.create).not.toHaveBeenCalled();
  });

  it('persists the proposed task locally, retrievable via get', async () => {
    const { service, repo } = buildService();
    const task = await service.propose({ title: 'Rappeler Alice', sourceRef: 'mail:m1' });
    expect(await repo.get(task.taskId)).toMatchObject({ status: 'proposed', title: 'Rappeler Alice' });
  });

  it('requires a non-empty title', async () => {
    const { service } = buildService();
    await expect(service.propose({ title: '', sourceRef: 'mail:m1' })).rejects.toThrow();
  });
});

describe('createTaskService.activate: the only method that writes to a provider', () => {
  it('calls provider.create exactly once and updates status to active with the returned revision', async () => {
    const { service, provider } = buildService();
    const proposed = await service.propose({ title: 'Rappeler Alice', sourceRef: 'mail:m1', providerId: 'google' });
    const activated = await service.activate(proposed.taskId);
    expect(provider.create).toHaveBeenCalledTimes(1);
    expect(activated.status).toBe('active');
    expect(activated.revision).toBe('r1');
  });

  it('checks capabilityBroker.authorize scoped to the task sourceRef before writing', async () => {
    const { service, capabilityBroker } = buildService();
    const proposed = await service.propose({ title: 'Rappeler Alice', sourceRef: 'mail:m1', providerId: 'google' });
    await service.activate(proposed.taskId);
    expect(capabilityBroker.authorize).toHaveBeenCalledWith(expect.objectContaining({ capability: 'personal.tasks', resource: 'mail:m1' }));
  });

  it('denies activation when the capability broker denies (e.g. an automation grant not scoped to this source)', async () => {
    const capabilityBroker = { authorize: vi.fn(async () => ({ decision: 'deny', reason: 'resource_scope' })) };
    const { service, provider } = buildService({ capabilityBroker });
    const proposed = await service.propose({ title: 'Rappeler Alice', sourceRef: 'mail:m1', providerId: 'google' });
    await expect(service.activate(proposed.taskId)).rejects.toThrow('resource_scope');
    expect(provider.create).not.toHaveBeenCalled();
  });

  it('rejects activating an already-active task', async () => {
    const { service } = buildService();
    const proposed = await service.propose({ title: 'Rappeler Alice', sourceRef: 'mail:m1', providerId: 'google' });
    await service.activate(proposed.taskId);
    await expect(service.activate(proposed.taskId)).rejects.toThrow('task_not_proposed');
  });

  it('rejects activating an unknown task', async () => {
    const { service } = buildService();
    await expect(service.activate('missing')).rejects.toThrow('task_not_found');
  });

  it('rejects an undeclared provider create action before changing local status', async () => {
    const provider = fakeProvider({ capabilities: Object.freeze(['sync']) });
    const { service, repo } = buildService({ hub: { adapter: () => provider } });
    const proposed = await service.propose({ title: 'Rappeler Alice', sourceRef: 'mail:m1', providerId: 'google' });

    await expect(service.activate(proposed.taskId)).rejects.toThrow('personal_action_unsupported_by_provider:create');
    expect(provider.create).not.toHaveBeenCalled();
    expect((await repo.get(proposed.taskId)).status).toBe('proposed');
  });
});

describe('createTaskService.complete: provider-backed state commits only after the provider succeeds', () => {
  it('completes a local-only (never activated) proposed task without touching the provider', async () => {
    const { service, provider } = buildService();
    const proposed = await service.propose({ title: 'Rappeler Alice', sourceRef: 'mail:m1' });
    const completed = await service.complete(proposed.taskId);
    expect(completed.status).toBe('completed');
    expect(provider.complete).not.toHaveBeenCalled();
  });

  it('confirms an active task with the provider before persisting completed locally', async () => {
    const { service, provider } = buildService();
    const proposed = await service.propose({ title: 'Rappeler Alice', sourceRef: 'mail:m1', providerId: 'google' });
    await service.activate(proposed.taskId);
    const completed = await service.complete(proposed.taskId);
    expect(completed.status).toBe('completed');
    expect(provider.complete).toHaveBeenCalledWith(expect.stringMatching(/^provider-/u));
  });

  it('leaves the task active when the provider call fails and throws sync_conflict', async () => {
    const provider = fakeProvider({ complete: vi.fn(async () => { throw new Error('provider_down'); }) });
    const { service, repo } = buildService({ hub: { adapter: () => provider } });
    const proposed = await service.propose({ title: 'Rappeler Alice', sourceRef: 'mail:m1', providerId: 'google' });
    await service.activate(proposed.taskId);

    await expect(service.complete(proposed.taskId)).rejects.toThrow('sync_conflict');
    expect((await repo.get(proposed.taskId)).status).toBe('active');
  });

  it('rejects an undeclared provider completion before changing local status', async () => {
    const provider = fakeProvider({ capabilities: Object.freeze(['sync', 'create']) });
    const { service, repo } = buildService({ hub: { adapter: () => provider } });
    const proposed = await service.propose({ title: 'Rappeler Alice', sourceRef: 'mail:m1', providerId: 'google' });
    await service.activate(proposed.taskId);

    await expect(service.complete(proposed.taskId)).rejects.toThrow('personal_action_unsupported_by_provider:complete');
    expect(provider.complete).not.toHaveBeenCalled();
    expect((await repo.get(proposed.taskId)).status).toBe('active');
  });

  it('rejects completing an unknown task', async () => {
    const { service } = buildService();
    await expect(service.complete('missing')).rejects.toThrow('task_not_found');
  });
});

describe('createTaskService.cancel', () => {
  it('cancels a proposed task locally without calling the provider', async () => {
    const { service, provider } = buildService();
    const proposed = await service.propose({ title: 'Rappeler Alice', sourceRef: 'mail:m1' });
    const cancelled = await service.cancel(proposed.taskId);
    expect(cancelled.status).toBe('cancelled');
    expect(provider.cancel).not.toHaveBeenCalled();
  });

  it('cancels an active task through the provider', async () => {
    const { service, provider } = buildService();
    const proposed = await service.propose({ title: 'Rappeler Alice', sourceRef: 'mail:m1', providerId: 'google' });
    await service.activate(proposed.taskId);
    await service.cancel(proposed.taskId);
    expect(provider.cancel).toHaveBeenCalledWith(expect.stringMatching(/^provider-/u));
  });
});

describe('createTaskService.sync', () => {
  it('persists synced tasks from the provider', async () => {
    const provider = fakeProvider({
      sync: vi.fn(async () => ({
        items: [{ taskId: 't1', providerId: 'google', title: 'Rappeler Alice', status: 'active', dueAt: null, sourceRef: null, revision: 'r1' }],
        removedIds: [], cursor: 'c2', hasMore: false,
      })),
    });
    const { service, repo } = buildService({ hub: { adapter: () => provider } });
    await service.sync('google');
    expect(await repo.get('t1')).toMatchObject({ title: 'Rappeler Alice', status: 'active' });
  });
});
