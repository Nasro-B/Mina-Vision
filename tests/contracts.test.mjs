import { describe, expect, it } from 'vitest';
import { CHANNELS, parseEnvelope } from '../src/contracts/envelope.mjs';
import { parseSessionEvent } from '../src/contracts/events.mjs';
import { CLAIM_STATUS, parseClaim } from '../src/contracts/claims.mjs';

const CREATED_AT = '2026-07-15T00:00:00.000Z';
const EXPIRES_AT = '2026-07-15T00:05:00.000Z';

function validEnvelope(overrides = {}) {
  return {
    version: 1,
    id: 'env-1',
    correlationId: 'corr-1',
    channel: 'local',
    kind: 'conversation.message',
    createdAt: CREATED_AT,
    expiresAt: EXPIRES_AT,
    sender: {
      identityId: 'owner-1',
      deviceId: 'desktop-1',
    },
    counter: 1,
    algorithms: { encryption: 'A256GCM', signature: 'ES256' },
    payloadCiphertext: 'ciphertext',
    nonce: 'nonce',
    authTag: 'tag',
    signature: 'signature',
    ...overrides,
  };
}

function validEvent(overrides = {}) {
  return {
    eventId: 'event-1',
    runtimeSessionId: 'runtime-1',
    workSessionId: 'work-1',
    type: 'before_turn',
    occurredAt: CREATED_AT,
    channel: 'voice',
    payload: { turnId: 'turn-1' },
    ...overrides,
  };
}

function validClaim(overrides = {}) {
  return {
    claimId: 'claim-1',
    sessionId: 'work-1',
    text: 'La page affiche le formulaire de recherche.',
    claimType: 'observed_state',
    status: 'verified',
    evidenceIds: ['evidence-1'],
    sourcePolicy: 'observed_source',
    freshnessDeadline: EXPIRES_AT,
    sensitivity: 'personal',
    createdAt: CREATED_AT,
    ...overrides,
  };
}

describe('versioned contracts', () => {
  it('exposes the closed channel and claim-status sets', () => {
    expect(CHANNELS).toEqual(['local', 'voice', 'sms', 'telegram']);
    expect(CLAIM_STATUS).toEqual([
      'verified',
      'inference',
      'uncertain',
      'not_found',
      'unsupported',
      'stale',
    ]);
    expect(Object.isFrozen(CHANNELS)).toBe(true);
    expect(Object.isFrozen(CLAIM_STATUS)).toBe(true);
  });

  it('parses valid values into immutable objects', () => {
    const envelope = parseEnvelope(validEnvelope());
    const event = parseSessionEvent(validEvent());
    const claim = parseClaim(validClaim());

    expect(Object.isFrozen(envelope)).toBe(true);
    expect(Object.isFrozen(envelope.sender)).toBe(true);
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.payload)).toBe(true);
    expect(Object.isFrozen(claim)).toBe(true);
    expect(Object.isFrozen(claim.evidenceIds)).toBe(true);
  });

  it('parses a structured JSON fact used for deterministic contradiction checks', () => {
    const claim = parseClaim(validClaim({
      fact: {
        key: 'home.bedroom.light.power',
        value: { state: 'on' },
        observedAt: CREATED_AT,
        polarity: 'present',
      },
    }));

    expect(claim.fact).toEqual({
      key: 'home.bedroom.light.power',
      value: { state: 'on' },
      observedAt: CREATED_AT,
      polarity: 'present',
    });
    expect(Object.isFrozen(claim.fact)).toBe(true);
    expect(Object.isFrozen(claim.fact.value)).toBe(true);
  });

  it.each([
    ['unknown fact key', { key: 'service.state', value: 'up', observedAt: CREATED_AT, polarity: 'present', extra: true }],
    ['invalid fact date', { key: 'service.state', value: 'up', observedAt: 'now', polarity: 'present' }],
    ['unknown fact polarity', { key: 'service.state', value: 'up', observedAt: CREATED_AT, polarity: 'maybe' }],
    ['non-JSON fact value', { key: 'service.state', value: undefined, observedAt: CREATED_AT, polarity: 'present' }],
  ])('rejects a fact with an %s', (_name, fact) => {
    expect(() => parseClaim(validClaim({ fact }))).toThrow();
  });

  it.each([
    ['envelope', () => parseEnvelope({ ...validEnvelope(), unexpected: true })],
    ['event', () => parseSessionEvent({ ...validEvent(), unexpected: true })],
    ['claim', () => parseClaim({ ...validClaim(), unexpected: true })],
  ])('rejects unknown keys in a %s', (_name, parse) => {
    expect(parse).toThrow();
  });

  it.each([
    ['empty envelope id', () => parseEnvelope(validEnvelope({ id: '' }))],
    ['empty nested sender id', () => parseEnvelope(validEnvelope({ sender: { identityId: '', deviceId: 'desktop-1' } }))],
    ['empty event type', () => parseSessionEvent(validEvent({ type: '' }))],
    ['empty claim text', () => parseClaim(validClaim({ text: '' }))],
    ['oversized identifier', () => parseClaim(validClaim({ claimId: 'x'.repeat(129) }))],
    ['oversized event type', () => parseSessionEvent(validEvent({ type: 'x'.repeat(81) }))],
  ])('rejects %s', (_name, parse) => {
    expect(parse).toThrow();
  });

  it.each([
    ['envelope creation date', () => parseEnvelope(validEnvelope({ createdAt: 'tomorrow' }))],
    ['envelope expiration date', () => parseEnvelope(validEnvelope({ expiresAt: 'later' }))],
    ['event date', () => parseSessionEvent(validEvent({ occurredAt: 'today' }))],
    ['claim date', () => parseClaim(validClaim({ createdAt: 'now' }))],
    ['claim freshness deadline', () => parseClaim(validClaim({ freshnessDeadline: 'soon' }))],
  ])('rejects an invalid %s', (_name, parse) => {
    expect(parse).toThrow();
  });

  it('rejects unknown channels in envelopes and events', () => {
    expect(() => parseEnvelope(validEnvelope({ channel: 'email' }))).toThrow();
    expect(() => parseSessionEvent(validEvent({ channel: 'email' }))).toThrow();
  });

  it('rejects an unknown claim status', () => {
    expect(() => parseClaim(validClaim({ status: 'probably_true' }))).toThrow();
  });

  it('rejects ciphertext larger than one MiB', () => {
    expect(() => parseEnvelope(validEnvelope({ payloadCiphertext: 'x'.repeat(1_048_577) }))).toThrow();
  });

  it('accepts a null expiration but rejects expiration before creation', () => {
    expect(parseEnvelope(validEnvelope({ expiresAt: null })).expiresAt).toBeNull();
    expect(() => parseEnvelope(validEnvelope({ expiresAt: '2026-07-14T23:59:59.999Z' }))).toThrow();
  });
});
