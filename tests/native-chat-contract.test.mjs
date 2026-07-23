import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { CHAT_EVENT_TYPES, CHAT_ROUTING_CLASSES, MAX_KEY_EPOCH, parseChatEvent } from '../src/contracts/chat.mjs';

const fixture = JSON.parse(
  await readFile(new URL('./fixtures/protocol/mina-chat-event-v2.json', import.meta.url), 'utf8'),
);
const withFixture = (overrides) => ({ ...fixture, ...overrides });

describe('contrat des événements mina_app (v2)', () => {
  it('accepte la fixture commune Node ↔ Kotlin', () => {
    const event = parseChatEvent(fixture);
    expect(event).toMatchObject({ version: 2, routingClass: 'message', deviceSequence: 1, keyEpoch: 1 });
    expect(Object.isFrozen(event)).toBe(true);
  });

  it('refuse tout champ supplémentaire — aucune extension silencieuse du protocole', () => {
    expect(() => parseChatEvent({ ...fixture, extra: 'x' })).toThrow(/chat_event_invalide/u);
  });

  it('refuse une séquence nulle, négative ou hors entier sûr', () => {
    expect(() => parseChatEvent(withFixture({ deviceSequence: 0 }))).toThrow(/chat_event_invalide/u);
    expect(() => parseChatEvent(withFixture({ deviceSequence: -1 }))).toThrow(/chat_event_invalide/u);
    expect(() => parseChatEvent(withFixture({ deviceSequence: Number.MAX_SAFE_INTEGER + 2 }))).toThrow(/chat_event_invalide/u);
  });

  it('borne keyEpoch à l\'Int Kotlin — sinon Android ne pourrait pas relire l\'événement', () => {
    expect(parseChatEvent(withFixture({ keyEpoch: MAX_KEY_EPOCH })).keyEpoch).toBe(MAX_KEY_EPOCH);
    expect(() => parseChatEvent(withFixture({ keyEpoch: MAX_KEY_EPOCH + 1 }))).toThrow(/chat_event_invalide/u);
    expect(() => parseChatEvent(withFixture({ keyEpoch: 0 }))).toThrow(/chat_event_invalide/u);
  });

  it('refuse une expiration incohérente ou supérieure à 30 jours', () => {
    expect(() => parseChatEvent(withFixture({ expiresAtMs: fixture.createdAtMs - 1 }))).toThrow(/chat_event_invalide/u);
    const tooLong = fixture.createdAtMs + 31 * 24 * 60 * 60 * 1_000;
    expect(() => parseChatEvent(withFixture({ expiresAtMs: tooLong }))).toThrow(/ttl_superieur_a_30_jours/u);
  });

  it('exige un eventId ULID majuscule et des identifiants ASCII bornés', () => {
    expect(() => parseChatEvent(withFixture({ eventId: '01arz3ndektsv4rrffq69g5fav' }))).toThrow(/chat_event_invalide/u);
    expect(() => parseChatEvent(withFixture({ eventId: 'trop-court' }))).toThrow(/chat_event_invalide/u);
    expect(() => parseChatEvent(withFixture({ threadId: 'fil accentué é' }))).toThrow(/chat_event_invalide/u);
    expect(() => parseChatEvent(withFixture({ senderDeviceId: 'a'.repeat(161) }))).toThrow(/chat_event_invalide/u);
  });

  it('exige une base64 canonique et des tailles exactes de nonce et de tag', () => {
    // Base64 non canonique : bits de bourrage non nuls, réencodage différent.
    expect(() => parseChatEvent(withFixture({ payloadCiphertext: 'Y2lwaGVydGV4dB==' }))).toThrow(/chat_event_invalide/u);
    expect(() => parseChatEvent(withFixture({ nonce: 'MDEyMzQ1Njc4OQ==' }))).toThrow(/nonce_invalide/u);
    expect(() => parseChatEvent(withFixture({ authTag: 'MDEyMzQ1Njc4OWFi' }))).toThrow(/auth_tag_invalide/u);
  });

  it('exige une signature DER P-256 plausible', () => {
    expect(() => parseChatEvent(withFixture({ signature: 'AAAA' }))).toThrow(/chat_event_invalide/u);
    expect(() => parseChatEvent(withFixture({ signature: Buffer.alloc(80, 0x30).toString('base64') }))).toThrow(/chat_event_invalide/u);
  });

  it('refuse une classe de routage inconnue et n\'expose que des classes grossières', () => {
    expect(() => parseChatEvent(withFixture({ routingClass: 'secret' }))).toThrow(/chat_event_invalide/u);
    expect(CHAT_ROUTING_CLASSES).toEqual(['message', 'receipt', 'control', 'stream', 'approval']);
    // Les types précis restent CHIFFRÉS : ils ne doivent jamais servir de classe de routage.
    for (const type of CHAT_EVENT_TYPES) expect(CHAT_ROUTING_CLASSES).not.toContain(type);
  });

  it('refuse une version différente de 2 — v1 garde son propre schéma', () => {
    expect(() => parseChatEvent(withFixture({ version: 1 }))).toThrow(/chat_event_invalide/u);
  });
});
