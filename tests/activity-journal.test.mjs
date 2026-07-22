import { describe, expect, it, vi } from 'vitest';
import { composeJournalBrief, createActivityJournal } from '../src/diagnostics/activity-journal.mjs';

const NOW = Date.parse('2026-07-20T10:00:00.000Z');

function harness({ now = NOW, retentionDays = 7 } = {}) {
  const files = new Map();
  const journal = createActivityJournal({
    directory: 'logs',
    appendFile: vi.fn(async (path, line) => files.set(path, (files.get(path) ?? '') + line)),
    readFile: vi.fn(async (path) => {
      if (!files.has(path)) throw new Error('ENOENT');
      return files.get(path);
    }),
    readdir: vi.fn(async () => [...files.keys()].map((path) => path.replace('logs/', ''))),
    rm: vi.fn(async (path) => files.delete(path)),
    mkdir: vi.fn(async () => {}),
    now: typeof now === 'function' ? now : () => now,
    retentionDays,
  });
  return { files, journal };
}

describe("createActivityJournal — journal persistant, borné, jamais bloquant", () => {
  it('appends JSONL entries to the daily file and reads them back newest-first', async () => {
    let clock = NOW;
    const { journal } = harness({ now: () => (clock += 1_000) });
    await journal.append('mission_started', { goal: 'ouvrir YouTube' });
    await journal.append('action_error', { error: 'browser_text_target_not_focused:body' });

    const entries = await journal.read({ limit: 10 });
    expect(entries).toHaveLength(2);
    expect(entries[0].kind).toBe('action_error');
    expect(entries[1].payload).toMatchObject({ goal: 'ouvrir YouTube' });
  });

  it('REDACTS secrets before anything touches the disk', async () => {
    const { journal, files } = harness();
    await journal.append('voice_error', {
      message: 'Authorization: Bearer abc.def.ghi failed, GROQ_API_KEY=gsk_abcdef123456789 rejected',
    });

    const raw = [...files.values()].join('');
    expect(raw).not.toContain('abc.def.ghi');
    expect(raw).not.toContain('gsk_abcdef123456789');
    expect(raw).toContain('[REDACTED]');
  });

  it('filters by kinds, caps the limit, and survives a corrupt line', async () => {
    const { journal, files } = harness();
    await journal.append('mission_started', { goal: 'a' });
    await journal.append('voice_engine', { engine: 'deepgram' });
    files.set('logs/activity-2026-07-20.jsonl', `${files.get('logs/activity-2026-07-20.jsonl')}{coupé en plein vol`);

    const missions = await journal.read({ kinds: ['mission_started'] });
    expect(missions).toHaveLength(1);
    expect(missions[0].kind).toBe('mission_started');
    const capped = await journal.read({ limit: 100_000 });
    expect(capped.length).toBeLessThanOrEqual(100);
  });

  it('reads across today AND yesterday — a question at 00:10 still sees the evening', async () => {
    const { journal, files } = harness();
    files.set('logs/activity-2026-07-19.jsonl', `${JSON.stringify({ at: NOW - 40_000_000, kind: 'mission_completed', payload: '{}' })}\n`);
    await journal.append('voice_engine', { engine: 'gemini' });

    const entries = await journal.read({ limit: 10 });
    expect(entries.map((entry) => entry.kind)).toEqual(['voice_engine', 'mission_completed']);
  });

  it('purges files beyond retention and keeps recent ones', async () => {
    const { journal, files } = harness({ retentionDays: 7 });
    files.set('logs/activity-2026-07-01.jsonl', 'vieux\n');
    files.set('logs/activity-2026-07-19.jsonl', 'récent\n');

    const result = await journal.purge();
    expect(result.removed).toBe(1);
    expect(files.has('logs/activity-2026-07-01.jsonl')).toBe(false);
    expect(files.has('logs/activity-2026-07-19.jsonl')).toBe(true);
  });

  it('never throws when the disk fails — journaling must not break the app', async () => {
    const journal = createActivityJournal({
      directory: 'logs',
      appendFile: vi.fn(async () => { throw new Error('EACCES'); }),
      readFile: vi.fn(async () => { throw new Error('EACCES'); }),
      readdir: vi.fn(async () => { throw new Error('EACCES'); }),
      rm: vi.fn(async () => { throw new Error('EACCES'); }),
      mkdir: vi.fn(async () => { throw new Error('EACCES'); }),
      now: () => NOW,
    });
    await expect(journal.append('mission_started', {})).resolves.toBeUndefined();
    await expect(journal.read()).resolves.toEqual([]);
    await expect(journal.purge()).resolves.toEqual({ removed: 0 });
  });
});

describe('composeJournalBrief — résumé parlable', () => {
  it('aggregates by kind with French labels and names the latest event', () => {
    const brief = composeJournalBrief([
      { at: 3, kind: 'action_error', payload: {} },
      { at: 2, kind: 'mission_started', payload: {} },
      { at: 1, kind: 'mission_started', payload: {} },
    ]);
    expect(brief).toContain('2 mission lancée');
    expect(brief).toContain('1 action en erreur');
    expect(brief).toContain('Dernier événement : action_error');
  });

  it('says plainly when the journal is empty', () => {
    expect(composeJournalBrief([])).toContain('vide');
  });
});

describe('journal wiring contract — every log stream reaches Mina', () => {
  it('persists the central event flow, guards crashes, reads worker stderr, and exposes lire_journal', async () => {
    const { readFile } = await import('node:fs/promises');
    const main = await readFile('src/ui/main.mjs', 'utf8');
    const preload = await readFile('src/ui/preload.cjs', 'utf8');
    const renderer = await readFile('src/ui/renderer.js', 'utf8');
    const desktopClient = await readFile('src/executors/desktop-client.mjs', 'utf8');
    const voiceClient = await readFile('src/voice/local-voice-client.mjs', 'utf8');

    // Central flow → persistent journal; boot + purge; engine switches recorded.
    expect(main).toMatch(/activityJournal\?\.append\(payload\?\.type \?\? 'event', payload\)/u);
    expect(main).toMatch(/void activityJournal\.purge\(\)/u);
    expect(main).toMatch(/append\('voice_engine', \{ engine: 'deepgram'/u);
    expect(main).toMatch(/append\('voice_engine', \{ engine: 'gemini' \}\)/u);

    // Crash guards: uncaught paths are RECORDED, not silent.
    expect(main).toMatch(/process\.on\('uncaughtException'/u);
    expect(main).toMatch(/process\.on\('unhandledRejection'/u);

    // Worker stderr no longer dropped.
    expect(desktopClient).toContain('onDiagnostic');
    expect(voiceClient).toContain('onDiagnostic');
    expect(main).toContain("workerDiagnostic('worker:desktop')");
    expect(main).toContain("workerDiagnostic('worker:kokoro')");
    // Node deprecation chatter must never pollute the error journal.
    expect(main).toMatch(/DeprecationWarning\|ExperimentalWarning/u);

    // Mina READS it: live tool + truth rule + deterministic path + UI bridge.
    expect(main).toContain("name: 'lire_journal'");
    expect(main).toMatch(/RÈGLE DE VÉRITÉ SUR LE PASSÉ/u);
    expect(main).toContain("ipcMain.handle('mina:journal-read'");
    expect(preload).toContain("ipcRenderer.invoke('mina:journal-read'");
    expect(renderer).toContain('composeJournalBrief');
    expect(renderer).toMatch(/action\?\.type === 'read_journal'/u);
  });
});
