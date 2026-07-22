import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGooglePersonalAdapter } from '../../src/personal/adapters/google-personal.mjs';
import { createPersonalDataHub } from '../../src/personal/personal-data-hub.mjs';
import { createTaskRepository } from '../../src/personal/task-repository.mjs';
import { createTaskService } from '../../src/personal/task-service.mjs';
import { applyPersonalCalendarMigrations, createCalendarRepository } from '../../src/personal/calendar-repository.mjs';
import { createCalendarService } from '../../src/personal/calendar-service.mjs';
import { createContactRepository } from '../../src/personal/contact-repository.mjs';
import { createContactService } from '../../src/personal/contact-service.mjs';
import { createJsonRepository } from '../../src/documents/document-repository.mjs';

// No real Google account is configured in this environment (OAuth consent is Nasro's own action —
// see docs/operations/GOOGLE-ACCOUNT.md). This integration test proves the REAL wiring — real
// SQLite files on disk, the real service layer, real propose/confirm/verify flows — using a fake
// OAuth transport standing in only for the network call, exactly the seam main.mjs itself crosses.

function fakeGoogleOAuth(responder) {
  return { request: vi.fn(async (_credentials, options) => ({ data: responder(options) })) };
}

let directory;
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); directory = undefined; });

describe('integration: Google personal runtime (tasks/calendar/contacts) — real disk, real services', () => {
  it('a task created and activated through the real service graph is persisted to a real SQLite-backed repository, surviving a simulated restart', async () => {
    directory = await mkdtemp(join(tmpdir(), 'mina-personal-'));
    const oauth = fakeGoogleOAuth((options) => {
      if (options.method === 'POST') return { id: 'tk-real', etag: '"r1"' };
      return {};
    });
    const adapter = createGooglePersonalAdapter({ oauth, credentialsProvider: async () => ({ accessToken: 'a' }) });
    const hub = createPersonalDataHub({ adapters: [adapter] });
    const repoFile = join(directory, 'tasks.sqlite');

    const firstProcess = createJsonRepository({ filename: repoFile, table: 'tasks' });
    const taskService = createTaskService({
      repository: createTaskRepository({ repository: firstProcess }), hub,
      capabilityBroker: { authorize: async () => ({ decision: 'allow', reason: 'confirmed_local_voice' }) },
      clock: Date.now,
    });
    const proposed = await taskService.propose({ title: 'Rappeler le fournisseur', dueAt: null, sourceRef: 'voice:local', providerId: 'google' });
    await taskService.activate(proposed.taskId);
    firstProcess.close();

    // Simulated restart: a brand-new repository instance backed by the SAME file.
    const secondProcess = createJsonRepository({ filename: repoFile, table: 'tasks' });
    const persisted = await createTaskRepository({ repository: secondProcess }).list();
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({ title: 'Rappeler le fournisseur', providerTaskId: 'tk-real' });
    secondProcess.close();
  });

  it('a calendar event goes through propose → confirm → verify against the REAL calendar SQLite schema (migrations applied)', async () => {
    directory = await mkdtemp(join(tmpdir(), 'mina-personal-'));
    const oauth = fakeGoogleOAuth((options) => {
      if (options.method === 'POST') return { id: 'ev-real', etag: '"ce1"' };
      if (options.method === 'GET') {
        return { id: 'ev-real', etag: '"ce1"', status: 'confirmed', summary: 'RDV fournisseur', start: { dateTime: '2026-08-01T09:00:00Z' }, end: { dateTime: '2026-08-01T10:00:00Z' } };
      }
      throw new Error(`unexpected ${options.method}`);
    });
    const adapter = createGooglePersonalAdapter({ oauth, credentialsProvider: async () => ({ accessToken: 'a' }) });
    const hub = createPersonalDataHub({ adapters: [adapter] });
    const db = new BetterSqlite3(join(directory, 'calendar.sqlite'));
    applyPersonalCalendarMigrations(db);
    const calendarService = createCalendarService({
      hub, repository: createCalendarRepository({ db, clock: Date.now }),
      capabilityBroker: { authorize: async () => ({ decision: 'allow', reason: 'confirmed_local_voice' }) },
      actionVerifier: { verify: async ({ receipt }) => ({ confirmed: Boolean(receipt) }) },
      confirmationService: { confirm: async () => true },
      clock: Date.now,
    });

    const proposal = await calendarService.proposeCreate({
      title: 'RDV fournisseur', startAt: '2026-08-01T09:00:00.000Z', endAt: '2026-08-01T10:00:00.000Z', providerId: 'google',
    });
    const created = await calendarService.commitProposal(proposal.proposalId);
    expect(created).toMatchObject({ eventId: 'ev-real', title: 'RDV fournisseur' });

    const stored = await calendarService.get('ev-real');
    expect(stored).toMatchObject({ title: 'RDV fournisseur' });
    db.close();
  });

  it('a voice-refused confirmation never creates the calendar event and never calls Google', async () => {
    directory = await mkdtemp(join(tmpdir(), 'mina-personal-'));
    const oauth = fakeGoogleOAuth(() => ({}));
    const adapter = createGooglePersonalAdapter({ oauth, credentialsProvider: async () => ({ accessToken: 'a' }) });
    const hub = createPersonalDataHub({ adapters: [adapter] });
    const db = new BetterSqlite3(join(directory, 'calendar.sqlite'));
    applyPersonalCalendarMigrations(db);
    const calendarService = createCalendarService({
      hub, repository: createCalendarRepository({ db, clock: Date.now }),
      capabilityBroker: { authorize: async () => ({ decision: 'allow', reason: 'confirmed_local_voice' }) },
      actionVerifier: { verify: async () => ({ confirmed: true }) },
      confirmationService: { confirm: async () => false }, // owner says no
      clock: Date.now,
    });

    const proposal = await calendarService.proposeCreate({ title: 'x', startAt: '2026-08-01T09:00:00.000Z', endAt: '2026-08-01T10:00:00.000Z', providerId: 'google' });
    await expect(calendarService.commitProposal(proposal.proposalId)).rejects.toThrow('confirmation_refused');
    expect(oauth.request).not.toHaveBeenCalled();
    db.close();
  });

  it('a contact synced through the real hub is found by lookup, exactly like main.mjs’s chercher_contact tool does', async () => {
    directory = await mkdtemp(join(tmpdir(), 'mina-personal-'));
    const oauth = fakeGoogleOAuth(() => ({
      connections: [{
        resourceName: 'people/p1', etag: '"pe1"', names: [{ displayName: 'Fournisseur Papeterie' }],
        emailAddresses: [{ value: 'contact@papeterie.example' }],
      }],
      nextSyncToken: 's1',
    }));
    const adapter = createGooglePersonalAdapter({ oauth, credentialsProvider: async () => ({ accessToken: 'a' }) });
    const hub = createPersonalDataHub({ adapters: [adapter] });
    const repo = createJsonRepository({ filename: join(directory, 'contacts.sqlite'), table: 'contacts' });
    const contactService = createContactService({
      repository: createContactRepository({ repository: repo }), hub,
      confirmationService: { confirm: async () => true }, clock: Date.now,
    });

    await contactService.sync('google');
    const people = await contactService.list();
    const match = people.find((person) => person.displayName.toLocaleLowerCase('fr-FR').includes('papeterie'));
    expect(match).toMatchObject({ displayName: 'Fournisseur Papeterie' });
    repo.close();
  });
});
