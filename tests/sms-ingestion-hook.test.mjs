import { describe, expect, it, vi } from 'vitest';
import { createPhoneMessageSync } from '../src/devices/phone-message-sync.mjs';
import { createMessageDeliveryLedger } from '../src/messaging/message-delivery-ledger.mjs';
import { mapPulledSmsToEvent, normalizeSmsEvent } from '../src/communications/communication-contract.mjs';
import { composeCommunicationsDomain } from '../src/communications/compose-communications-domain.mjs';

const SMS = { id: 'm-sms', channel: 'sms', sender: '+33612345678', body: 'peux-tu me rappeler demain', sentAtMs: 1000 };
const TG = { id: 'm-tg', channel: 'telegram', sender: '123', body: 'salut', sentAtMs: 1000 };

function buildSync({ onInboundSms = null } = {}) {
  const phoneBridge = {
    detect: async () => ({ deviceId: 'dev-A' }),
    ensureGatewayService: async () => {},
    pullPendingMessages: async () => ({ messages: [SMS, TG] }),
    ackPendingMessages: async ({ messageIds }) => ({ acked: messageIds.length }),
    sendTelegramMessage: async () => ({ providerMessageId: 'p1' }),
  };
  const memoryController = { rememberRemoteMessage: vi.fn(async () => {}) };
  const telegramResponder = { reply: async () => 'réponse' };
  const ledger = createMessageDeliveryLedger({ filename: ':memory:' });
  return createPhoneMessageSync({ phoneBridge, memoryController, telegramResponder, ledger, onInboundSms });
}

describe('hook d’ingestion SMS dans le pull loop', () => {
  it('sans hook (défaut) : comportement inchangé, tout est acké', async () => {
    const report = await buildSync().run();
    expect(report.acked).toBe(2); // SMS + Telegram
  });

  it('avec hook : appelé pour le SMS uniquement, jamais pour le Telegram', async () => {
    const onInboundSms = vi.fn(async () => {});
    await buildSync({ onInboundSms }).run();
    expect(onInboundSms).toHaveBeenCalledTimes(1);
    expect(onInboundSms).toHaveBeenCalledWith(SMS, 'dev-A');
  });

  it('une erreur d’ingestion ne bloque JAMAIS l’ack ni le pull', async () => {
    const onInboundSms = vi.fn(async () => { throw new Error('ingestion cassée'); });
    const report = await buildSync({ onInboundSms }).run();
    expect(report.acked).toBe(2); // le SMS est quand même acké
  });

  it('mapPulledSmsToEvent produit une entrée valide pour normalizeSmsEvent', () => {
    const event = normalizeSmsEvent(mapPulledSmsToEvent(SMS, 'dev-A'));
    expect(event).toMatchObject({ kind: 'sms', deviceId: 'dev-A', senderE164: '+33612345678', direction: 'inbound' });
    expect(event.subscriptionId).toBe('sim_ambiguous'); // le pull ne porte pas de SIM
    expect(event.dedupeKey).toMatch(/^[0-9a-f]{32}$/u);
  });

  it('intégration : le SMS pull → tâche en file dans le domaine communications', async () => {
    const domain = composeCommunicationsDomain({ masterKey: Buffer.alloc(32, 5), filename: ':memory:', taskApi: null });
    const onInboundSms = (message, deviceId) => domain.ingestSms(mapPulledSmsToEvent(message, deviceId));
    await buildSync({ onInboundSms }).run();
    expect(domain.status().pendingTasks).toBe(1); // « rappeler » = actionnable → tâche différée
    domain.close();
  });
});
