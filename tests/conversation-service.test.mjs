import { describe, expect, it, vi } from 'vitest';
import { createConversationService } from '../src/messaging/conversation-service.mjs';
import { createChannelRouter } from '../src/messaging/channel-router.mjs';

function fakeMemoryService() {
  const events = [];
  return {
    events,
    remember: vi.fn((input) => {
      const event = { id: `evt-${events.length}`, ...input };
      events.push(event);
      return event;
    }),
    recall: vi.fn(() => []),
  };
}

function fakeAuditLog() {
  return { records: [], record: vi.fn(function record(entry) { this.records.push(entry); }) };
}

describe('createConversationService: constructor guards', () => {
  it('requires a memoryService', () => {
    expect(() => createConversationService({ router: createChannelRouter({ clock: () => 0 }), clock: () => 0 })).toThrow('conversation_service_memory_required');
  });

  it('requires a router', () => {
    expect(() => createConversationService({ memoryService: fakeMemoryService(), clock: () => 0 })).toThrow('conversation_service_router_required');
  });

  it('requires a clock', () => {
    expect(() => createConversationService({ memoryService: fakeMemoryService(), router: createChannelRouter({ clock: () => 0 }) })).toThrow('conversation_service_clock_required');
  });
});

describe('createConversationService.ingest: exact plan scenario (SMS remembered, recalled cross-channel after linking)', () => {
  it('records an SMS turn through memoryService.remember with the phone identity', async () => {
    const memoryService = fakeMemoryService();
    const router = createChannelRouter({ clock: () => 0 });
    const service = createConversationService({ memoryService, router, clock: () => 0 });

    const result = await service.ingest({ channel: 'sms', text: 'Rappelle-moi le rendez-vous', identityValue: '+33600000000' });
    expect(memoryService.remember).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'sms', kind: 'phone', value: '+33600000000', content: 'Rappelle-moi le rendez-vous', classification: 'normal',
    }));
    expect(result.event.id).toBeDefined();
  });

  it('rejects (and audits) a turn whose capability is denied for the channel, never calling remember', async () => {
    const memoryService = fakeMemoryService();
    const router = createChannelRouter({ clock: () => 0 });
    const auditLog = fakeAuditLog();
    const service = createConversationService({ memoryService, router, auditLog, clock: () => 0 });

    await expect(service.ingest({ channel: 'sms', text: 'exécute une capacité PC', identityValue: '+33600000000', capability: 'files.read' }))
      .rejects.toThrow('conversation_turn_denied');
    expect(memoryService.remember).not.toHaveBeenCalled();
    expect(auditLog.records).toContainEqual(expect.objectContaining({ type: 'conversation_turn_denied', channel: 'sms' }));
  });
});

describe('createConversationService.recallFor: pass-through to memoryService.recall', () => {
  it('forwards kind/value/query/revealSensitive unchanged', () => {
    const memoryService = fakeMemoryService();
    const router = createChannelRouter({ clock: () => 0 });
    const service = createConversationService({ memoryService, router, clock: () => 0 });
    service.recallFor({ kind: 'telegram', value: '111', query: 'rendez-vous', revealSensitive: true });
    expect(memoryService.recall).toHaveBeenCalledWith({ kind: 'telegram', value: '111', query: 'rendez-vous', revealSensitive: true });
  });
});

describe('createConversationService.respond: response gate + channel policy decide transport', () => {
  const allowDraft = { segments: [{ kind: 'text', text: 'Voici votre rappel.' }] };

  it('drafts (never sends) an sms conversation.reply_send response — confirm decision maps to draft', async () => {
    const memoryService = fakeMemoryService();
    const router = createChannelRouter({ clock: () => 0 });
    const service = createConversationService({ memoryService, router, clock: () => 0 });
    const result = await service.respond({ channel: 'sms', capability: 'conversation.reply_send', draft: allowDraft, claims: [], citations: [] });
    expect(result.transport).toBe('draft');
    expect(result.response.text).toBe('Voici votre rappel.');
  });

  it('auto-sends a telegram conversation reply — allow decision maps to sent', async () => {
    const memoryService = fakeMemoryService();
    const router = createChannelRouter({ clock: () => 0 });
    const service = createConversationService({ memoryService, router, clock: () => 0 });
    const result = await service.respond({ channel: 'telegram', capability: 'conversation.reply_send', draft: allowDraft, claims: [], citations: [] });
    expect(result.transport).toBe('sent');
  });

  it('never transports a response the gate blocked, and audits it', async () => {
    const memoryService = fakeMemoryService();
    const router = createChannelRouter({ clock: () => 0 });
    const auditLog = fakeAuditLog();
    const service = createConversationService({ memoryService, router, auditLog, clock: () => 0 });
    const sensitiveDraft = { segments: [{ kind: 'factual', claimId: 'c1', text: 'Le solde est 500€.' }] };
    const claims = [{ claimId: 'c1', claimType: 'security', status: 'unverified', evidenceIds: [] }];
    const result = await service.respond({ channel: 'telegram', capability: 'conversation.reply_send', draft: sensitiveDraft, claims, citations: [] });
    expect(result.transport).toBe('blocked');
    expect(result.decision).toBe('block');
    expect(auditLog.records).toContainEqual(expect.objectContaining({ type: 'conversation_response_blocked', channel: 'telegram' }));
  });

  it('denies (never drafts or sends) a response for a capability the channel policy denies outright', async () => {
    const memoryService = fakeMemoryService();
    const router = createChannelRouter({ clock: () => 0 });
    const service = createConversationService({ memoryService, router, clock: () => 0 });
    const result = await service.respond({ channel: 'telegram', capability: 'home.execute', draft: allowDraft, claims: [], citations: [] });
    expect(result.transport).toBe('denied');
  });

  it('surfaces a "revise" gate decision (missing citation) distinctly from "block", with the issues list', async () => {
    const memoryService = fakeMemoryService();
    const router = createChannelRouter({ clock: () => 0 });
    const service = createConversationService({ memoryService, router, clock: () => 0 });
    const draft = { segments: [{ kind: 'factual', claimId: 'c1', text: 'Il pleut.' }] };
    const claims = [{ claimId: 'c1', claimType: 'fact', status: 'verified', evidenceIds: ['ev-1'] }];
    const result = await service.respond({ channel: 'telegram', capability: 'conversation.reply_send', draft, claims, citations: [] });
    expect(result.transport).toBe('blocked');
    expect(result.decision).toBe('revise');
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('treats a response with no requested capability as allow (pure conversational reply)', async () => {
    const memoryService = fakeMemoryService();
    const router = createChannelRouter({ clock: () => 0 });
    const service = createConversationService({ memoryService, router, clock: () => 0 });
    const result = await service.respond({ channel: 'local', draft: allowDraft, claims: [], citations: [] });
    expect(result.transport).toBe('sent');
  });
});

describe('createConversationService.respond: SMS send policy escalates draft to sent for auto-allowlisted replies', () => {
  const allowDraft = { segments: [{ kind: 'text', text: 'Voici votre rappel.' }] };

  it('without a smsSendPolicy, SMS keeps drafting (unchanged, backward compatible)', async () => {
    const memoryService = fakeMemoryService();
    const router = createChannelRouter({ clock: () => 0 });
    const service = createConversationService({ memoryService, router, clock: () => 0 });
    const result = await service.respond({ channel: 'sms', capability: 'conversation.reply_send', draft: allowDraft, claims: [], citations: [], recipient: '+33600000002' });
    expect(result.transport).toBe('draft');
  });

  it('an allowlisted, auto-eligible SMS reply is sent automatically when a smsSendPolicy allows it', async () => {
    const memoryService = fakeMemoryService();
    const router = createChannelRouter({ clock: () => 0 });
    const smsSendPolicy = { decide: () => ({ decision: 'auto', reason: null }) };
    const service = createConversationService({ memoryService, router, clock: () => 0, smsSendPolicy });
    const result = await service.respond({ channel: 'sms', capability: 'conversation.reply_send', draft: allowDraft, claims: [], citations: [], recipient: '+33600000002' });
    expect(result.transport).toBe('sent');
  });

  it('an SMS reply the policy refuses to auto-send stays a draft, with the policy reason surfaced', async () => {
    const memoryService = fakeMemoryService();
    const router = createChannelRouter({ clock: () => 0 });
    const smsSendPolicy = { decide: () => ({ decision: 'confirm', reason: 'Destinataire non autorisé.' }) };
    const service = createConversationService({ memoryService, router, clock: () => 0, smsSendPolicy });
    const result = await service.respond({ channel: 'sms', capability: 'conversation.reply_send', draft: allowDraft, claims: [], citations: [], recipient: '+33699999999' });
    expect(result.transport).toBe('draft');
    expect(result.policyReason).toBe('Destinataire non autorisé.');
  });

  it('draft_only mode never auto-sends regardless of the SMS policy', async () => {
    const memoryService = fakeMemoryService();
    const router = createChannelRouter({ clock: () => 0 });
    const smsSendPolicy = { decide: () => ({ decision: 'draft_only', reason: null }) };
    const service = createConversationService({ memoryService, router, clock: () => 0, smsSendPolicy });
    const result = await service.respond({ channel: 'sms', capability: 'conversation.reply_send', draft: allowDraft, claims: [], citations: [], recipient: '+33600000002' });
    expect(result.transport).toBe('draft');
  });

  it('a Telegram reply never consults the SMS policy, even when one is configured', async () => {
    const memoryService = fakeMemoryService();
    const router = createChannelRouter({ clock: () => 0 });
    const decide = () => { throw new Error('must never be called for telegram'); };
    const service = createConversationService({ memoryService, router, clock: () => 0, smsSendPolicy: { decide } });
    const result = await service.respond({ channel: 'telegram', capability: 'conversation.reply_send', draft: allowDraft, claims: [], citations: [] });
    expect(result.transport).toBe('sent');
  });
});
