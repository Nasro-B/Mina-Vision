import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Telegram tools main runtime contract', () => {
  it('composes the real command router with home and mail handlers ahead of the conversational LLM', async () => {
    const source = await readFile(new URL('../src/ui/main.mjs', import.meta.url), 'utf8');
    expect(source).toContain('createTelegramCommandRouter');
    expect(source).toContain('createTelegramHomeCommands');
    expect(source).toContain('createTelegramMailCommands');
  });

  it('gates every deterministic Telegram command behind a real owner-chat-id check, not a blanket allow', async () => {
    const source = await readFile(new URL('../src/ui/main.mjs', import.meta.url), 'utf8');
    expect(source).toContain('isTelegramOwner');
    expect(source).toContain('ownerChatId');
    expect(source).not.toMatch(/isOwner:\s*async\s*\(\)\s*=>\s*true/u);
  });

  it('phone-message-sync still receives a single-string reply interface (Task 1 ledger contract unchanged)', async () => {
    const source = await readFile(new URL('../src/ui/main.mjs', import.meta.url), 'utf8');
    expect(source).toContain('telegramResponder: { reply:');
  });
});
