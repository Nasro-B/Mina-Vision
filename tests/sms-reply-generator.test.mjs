import { describe, expect, it, vi } from 'vitest';
import { createSmsReplyGenerator } from '../src/communications/sms-reply-generator.mjs';
import { createSmsSendPolicy } from '../src/messaging/sms-send-policy.mjs';

const inbound = (over = {}) => ({ senderE164: '+33612345678', body: 'peux-tu me rappeler ?', deviceId: 'dev-A', ...over });

describe('sms-reply-generator (C2 — le flux de génération manquant)', () => {
  it('exige draftReply + policy', () => {
    expect(() => createSmsReplyGenerator({ draftReply: null, policy: { decide() {} } })).toThrow('dependencies_required');
    expect(() => createSmsReplyGenerator({ draftReply: () => '', policy: null })).toThrow('dependencies_required');
  });

  it('génère un brouillon puis laisse la politique décider — confirm par défaut', async () => {
    const draftReply = vi.fn(async () => 'Bonjour, je vous rappelle après 16h. — Mina');
    const policy = createSmsSendPolicy({ mode: 'confirm_every_send' });
    const gen = createSmsReplyGenerator({ draftReply, policy, persona: 'standardiste polie' });
    const out = await gen.propose({ inbound: inbound(), dailyInstructions: 'rappeler après 16h' });
    expect(out).toMatchObject({ decision: 'confirm', reply: expect.stringContaining('16h'), recipient: '+33612345678', deviceId: 'dev-A' });
    // Anti-injection : le corps entrant est passé comme champ `message`, la consigne vient du propriétaire.
    expect(draftReply).toHaveBeenCalledWith(expect.objectContaining({ message: 'peux-tu me rappeler ?', dailyInstructions: 'rappeler après 16h' }));
  });

  it('brouillon vide → skip (rien à envoyer, jamais d’SMS vide)', async () => {
    const gen = createSmsReplyGenerator({ draftReply: async () => '   ', policy: createSmsSendPolicy() });
    const out = await gen.propose({ inbound: inbound() });
    expect(out).toMatchObject({ decision: 'skip', reason: 'aucun_brouillon', reply: '' });
  });

  it('mode auto_allowlisted + destinataire autorisé + contenu neutre → auto', async () => {
    const policy = createSmsSendPolicy({ mode: 'auto_allowlisted', allowlist: ['+33612345678'], maxPerMinute: 5, maxPerDay: 50 });
    const gen = createSmsReplyGenerator({ draftReply: async () => 'Bien reçu, merci.', policy });
    const out = await gen.propose({ inbound: inbound(), ownerRecognized: true });
    expect(out.decision).toBe('auto');
  });

  it('contenu sensible dans le brouillon → la politique force confirm (jamais auto)', async () => {
    const policy = createSmsSendPolicy({ mode: 'auto_allowlisted', allowlist: ['+33612345678'], maxPerMinute: 5, maxPerDay: 50 });
    const gen = createSmsReplyGenerator({ draftReply: async () => 'Votre code de vérification est 4821.', policy });
    const out = await gen.propose({ inbound: inbound() });
    expect(out.decision).toBe('confirm');
  });

  it('tronque à maxLength et rejette un entrant invalide', async () => {
    const gen = createSmsReplyGenerator({ draftReply: async () => 'x'.repeat(999), policy: createSmsSendPolicy(), maxLength: 10 });
    const out = await gen.propose({ inbound: inbound() });
    expect(out.reply).toHaveLength(10);
    await expect(gen.propose({ inbound: { senderE164: '', body: '' } })).rejects.toThrow('sms_reply_inbound_invalid');
  });
});
