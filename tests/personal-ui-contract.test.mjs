import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyPersonalGraphMigrations, createGraphRepository } from '../src/graph/graph-repository.mjs';
import { createPersonalGraph } from '../src/graph/personal-graph.mjs';
import { createEntityResolver } from '../src/graph/entity-resolver.mjs';
import { createDailyBriefingService } from '../src/personal/daily-briefing-service.mjs';
import { createTodayController } from '../src/ui/pages/today-controller.mjs';
import { createGraphController } from '../src/ui/pages/graph-controller.mjs';
import { registerMinaIpc, CORE_CHANNELS } from '../src/ui/ipc/register-ipc.mjs';

function fakeIpcMain() {
  const handlers = new Map();
  return { handle: vi.fn((channel, handler) => handlers.set(channel, handler)), handlers };
}

let db;
let directory;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'mina-personal-ui-'));
  db = new Database(join(directory, 'personal-graph.sqlite'));
  applyPersonalGraphMigrations(db);
});

afterEach(async () => {
  if (db?.open) db.close();
  await rm(directory, { recursive: true, force: true });
});

function buildWorld() {
  const clock = () => 1_700_000_000_000;
  const graphRepository = createGraphRepository({ db, clock });
  const personalGraph = createPersonalGraph({ repository: graphRepository, clock });
  const entityResolver = createEntityResolver({ repository: graphRepository });
  const dailyBriefingService = createDailyBriefingService({ clock });

  return {
    todayController: createTodayController({ dailyBriefingService }),
    graphController: createGraphController({ personalGraph, entityResolver }),
    personalGraph,
  };
}

describe('today/graph controllers: constructor guards', () => {
  it('createTodayController requires its dependencies', () => {
    expect(() => createTodayController({})).toThrow('today_controller_dependencies_required');
  });

  it('createGraphController requires its dependencies', () => {
    expect(() => createGraphController({})).toThrow('graph_controller_dependencies_required');
  });
});

describe('IPC channel allowlist: mina:personal:*, mina:graph:*, mina:routines:*', () => {
  it('registers the named channels for both controllers', () => {
    const { todayController, graphController } = buildWorld();
    const ipcMain = fakeIpcMain();
    const { channels } = registerMinaIpc({
      ipcMain, coreChannels: CORE_CHANNELS,
      controllers: { personal: { today: todayController, graph: graphController } },
    });

    expect(channels).toContain('mina:personal:briefing');
    expect(channels).toContain('mina:routines:list');
    expect(channels).toContain('mina:graph:subgraph');
    expect(channels).toContain('mina:graph:resolve-entity');
  });

  it('never registers a raw graph-serialization escape hatch', () => {
    const { todayController, graphController } = buildWorld();
    const ipcMain = fakeIpcMain();
    const { channels } = registerMinaIpc({
      ipcMain, coreChannels: CORE_CHANNELS,
      controllers: { personal: { today: todayController, graph: graphController } },
    });
    expect(channels).not.toContain('mina:graph:dump-all');
    expect(channels).not.toContain('mina:graph:export-full');
  });
});

describe('today-controller.getBriefing: end to end with the real daily-briefing-service', () => {
  it('returns a grounded briefing', async () => {
    const { todayController } = buildWorld();
    const briefing = await todayController.getBriefing({ identityId: 'owner', asOf: 1_700_000_000_000, channel: 'telegram' });
    expect(briefing).toMatchObject({ identityId: 'owner', channel: 'telegram' });
  });
});

describe('graph-controller: subgraph is always policy-bounded, never the raw whole graph', () => {
  it('getSubgraph applies a default policy allowlist when none is given', async () => {
    const { graphController, personalGraph } = buildWorld();
    const alice = await personalGraph.upsertEntity({ entityType: 'person', displayName: 'Alice' });
    const result = await graphController.getSubgraph({ startEntityId: alice.entityId });
    expect(result.nodes).toHaveLength(1);
  });

  it('resolveEntity never fuses on a bare name alone', async () => {
    const { graphController, personalGraph } = buildWorld();
    await personalGraph.upsertEntity({ entityType: 'person', displayName: 'Mohamed', attributes: { name: 'Mohamed' } });
    const result = await graphController.resolveEntity({ name: 'Mohamed' });
    expect(result.status).toBe('ambiguous');
  });
});
