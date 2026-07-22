import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('personal (Google Tasks/Calendar/Contacts) main runtime contract', () => {
  it('composes real task, calendar and contact services from the SAME Google personal adapter, never three separate accounts', async () => {
    const source = await readFile(new URL('../src/ui/main.mjs', import.meta.url), 'utf8');
    expect(source).toContain('createTaskService');
    expect(source).toContain('createCalendarService');
    expect(source).toContain('createContactService');
    expect(source).toContain('createPersonalDataHub({ adapters: [googleRuntime.googlePersonalAdapter] })');
  });

  it('persists tasks and contacts to disk instead of an in-memory Map lost on restart', async () => {
    const source = await readFile(new URL('../src/ui/main.mjs', import.meta.url), 'utf8');
    expect(source).not.toMatch(/const rows = new Map\(\);[\s\S]{0,200}googleTaskService/u);
    expect(source).toContain('mina-personal-tasks.sqlite');
    expect(source).toContain('mina-personal-contacts.sqlite');
    expect(source).toContain('applyPersonalCalendarMigrations(personalCalendarDatabase)');
  });

  it('exposes voice tools for tasks, calendar and contacts, each behind local confirmation for writes', async () => {
    const source = await readFile(new URL('../src/ui/main.mjs', import.meta.url), 'utf8');
    for (const tool of ['creer_tache_google', 'creer_evenement_calendrier', 'chercher_contact']) {
      expect(source).toContain(`name: '${tool}'`);
    }
    const calendarFn = source.slice(source.indexOf('const createCalendarEventFromVoice'), source.indexOf('const lookupContactFromVoice'));
    expect(calendarFn).toContain('proposeCreate');
    expect(calendarFn).toContain('commitProposal');
  });

  it('the contact lookup tool is read-only: it never calls Google live, only the local synced mirror', async () => {
    const source = await readFile(new URL('../src/ui/main.mjs', import.meta.url), 'utf8');
    const lookupFn = source.slice(source.indexOf('const lookupContactFromVoice'), source.indexOf('const sendEmailFromVoice'));
    expect(lookupFn).toContain('googleContactService.list');
    expect(lookupFn).not.toContain('.sync(');
  });

  it('closes the personal calendar database on shutdown, like every other persisted store', async () => {
    const source = await readFile(new URL('../src/ui/main.mjs', import.meta.url), 'utf8');
    expect(source).toContain('personalCalendarDatabase.close()');
  });
});
