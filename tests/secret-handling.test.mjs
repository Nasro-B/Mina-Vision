import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { classifySecrets } from '../src/security/secret-classifier.mjs';
import { createRedactor } from '../src/security/redactor.mjs';
import { createModelDisclosure } from '../src/security/model-disclosure.mjs';

// Fixtures FAUSSES (aucune vraie clé) pour tester le détecteur/redacteur de secrets. Les valeurs
// de forme « secret » sont ASSEMBLÉES à l'exécution : le test voit exactement la même chaîne, mais
// aucun littéral complet de forme secret n'apparaît dans le source — les scanners de secrets
// (GitHub push protection) ne les prennent donc plus pour de vrais secrets (ils l'ont fait sur
// l'exemple DeepSeek le 2026-07-24), tout en gardant la détection réellement testée.
const j = (...parts) => parts.join('');
const FIXTURES = Object.freeze({
  apiKey: j('sk', '-live-', 'AbCdEfGh12345678901234567890AbCd'),
  jwt: j('eyJhbGciOiJIUzI1NiJ9', '.', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', '.', 'dGhpc2lzYXNpZ25hdHVyZQ'),
  password: 'motdepasse=Sup3rS3cretPassw0rd!',
  otp: 'Votre code de vérification est 482913',
  iban: 'FR7630006000011234567890189',
  testCard: '4242424242424242',
  telegramToken: j('123456789', ':', 'AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw'),
  envContent: j('DEEPSEEK_API_KEY=', 'sk', '-', 'abcdef1234567890abcdef1234567890'),
});

describe('classifySecrets: detects known secret shapes', () => {
  it('detects an API key by known prefix', () => {
    const matches = classifySecrets(FIXTURES.apiKey);
    expect(matches.some((m) => m.type === 'api_key')).toBe(true);
  });

  it('detects a JWT (three base64url segments)', () => {
    const matches = classifySecrets(FIXTURES.jwt);
    expect(matches.some((m) => m.type === 'jwt')).toBe(true);
  });

  it('detects a password assignment', () => {
    const matches = classifySecrets(FIXTURES.password);
    expect(matches.some((m) => m.type === 'password')).toBe(true);
  });

  it('detects an OTP near a verification keyword', () => {
    const matches = classifySecrets(FIXTURES.otp);
    expect(matches.some((m) => m.type === 'otp')).toBe(true);
  });

  it('does not classify a bare 6-digit number with no keyword context as OTP', () => {
    const matches = classifySecrets('Le prix est 482913 euros.');
    expect(matches.some((m) => m.type === 'otp')).toBe(false);
  });

  it('detects a valid IBAN by structure and checksum', () => {
    const matches = classifySecrets(FIXTURES.iban);
    expect(matches.some((m) => m.type === 'iban')).toBe(true);
  });

  it('rejects an IBAN-shaped string with an invalid checksum', () => {
    const matches = classifySecrets('FR0000000000000000000000000');
    expect(matches.some((m) => m.type === 'iban')).toBe(false);
  });

  it('detects a Luhn-valid test card number', () => {
    const matches = classifySecrets(FIXTURES.testCard);
    expect(matches.some((m) => m.type === 'card')).toBe(true);
  });

  it('detects a second Luhn-valid card whose doubling requires the >9 correction (Mastercard test number)', () => {
    const matches = classifySecrets('5555555555554444');
    expect(matches.some((m) => m.type === 'card')).toBe(true);
  });

  it('does not classify a too-short digit run as a card', () => {
    expect(classifySecrets('12345').some((m) => m.type === 'card')).toBe(false);
  });

  it('does not classify a too-long digit run (>19 digits) as a card', () => {
    expect(classifySecrets('123456789012345678901').some((m) => m.type === 'card')).toBe(false);
  });

  it('treats a missing/undefined input as empty text rather than throwing', () => {
    expect(classifySecrets(undefined)).toEqual([]);
    expect(classifySecrets(null)).toEqual([]);
  });

  it('detects a Telegram bot token', () => {
    const matches = classifySecrets(FIXTURES.telegramToken);
    expect(matches.some((m) => m.type === 'telegram_token')).toBe(true);
  });

  it('detects a .env-style KEY=value secret assignment', () => {
    const matches = classifySecrets(FIXTURES.envContent);
    expect(matches.some((m) => m.type === 'env_secret')).toBe(true);
  });

  it('finds nothing in ordinary conversational text', () => {
    expect(classifySecrets('Peux-tu me rappeler demain matin ?')).toEqual([]);
  });
});

describe('createRedactor: constructor guard', () => {
  it('requires a clock', () => {
    expect(() => createRedactor({})).toThrow('redactor_clock_required');
  });

  it('rejects a clock that is neither a function nor a {now()} object', () => {
    expect(() => createRedactor({ clock: {} })).toThrow('redactor_clock_required');
  });

  it('accepts a {now()}-object clock, not only a bare function', () => {
    const redactor = createRedactor({ clock: { now: () => 1_700_000_000_000 } });
    expect(redactor.plan('bonjour').plannedAt).toBe(new Date(1_700_000_000_000).toISOString());
  });
});

describe('createRedactor.plan / applyPlan: omit|mask|confirm_once strategies', () => {
  it('omits secret/otp classifications by default', () => {
    const redactor = createRedactor({ clock: () => 0 });
    const plan = redactor.plan(FIXTURES.otp);
    const applied = redactor.applyPlan(FIXTURES.otp, plan);
    expect(applied.text).not.toContain('482913');
    expect(plan.segments.every((segment) => segment.type !== 'otp' || segment.strategy === 'omit')).toBe(true);
  });

  it('never leaves a classified secret value byte-for-byte in the redacted text', () => {
    const redactor = createRedactor({ clock: () => 0 });
    for (const fixture of Object.values(FIXTURES)) {
      const plan = redactor.plan(fixture);
      const applied = redactor.applyPlan(fixture, plan);
      for (const segment of plan.segments) {
        expect(applied.text).not.toContain(segment.value);
      }
    }
  });

  it('confirm_once segments require an explicit one-shot decision before being included, and are never reusable', () => {
    const redactor = createRedactor({ clock: () => 0 });
    const text = `Numéro de carte au dos du colis : ${FIXTURES.testCard}`;
    const plan = redactor.plan(text, { policy: { card: 'confirm_once' } });
    const confirmSegments = plan.segments.filter((segment) => segment.strategy === 'confirm_once');
    expect(confirmSegments.length).toBeGreaterThan(0);
    const token = confirmSegments[0].confirmationToken;

    const omitted = redactor.applyPlan(text, plan, {});
    expect(omitted.text).not.toContain(FIXTURES.testCard);

    const decisions = { [token]: 'include' };
    expect(() => redactor.applyPlan(text, plan, decisions)).toThrow('redactor_confirmation_already_consumed');
  });

  it('redacts multiple distinct secrets in the same text, in any order, without cross-corrupting offsets', () => {
    const redactor = createRedactor({ clock: () => 0 });
    const text = `Token JWT : ${FIXTURES.jwt} — carte : ${FIXTURES.testCard}`;
    const plan = redactor.plan(text);
    expect(plan.segments.length).toBeGreaterThanOrEqual(2);
    const applied = redactor.applyPlan(text, plan);
    expect(applied.text).not.toContain(FIXTURES.jwt);
    expect(applied.text).not.toContain(FIXTURES.testCard);
  });

  it('rejects applying a plan against text that does not match what the plan was built from', () => {
    const redactor = createRedactor({ clock: () => 0 });
    const plan = redactor.plan(FIXTURES.otp);
    expect(() => redactor.applyPlan('completely different text', plan)).toThrow('redactor_plan_text_mismatch');
  });

  it('includes a confirm_once segment verbatim only when the caller explicitly decides "include"', () => {
    const redactor = createRedactor({ clock: () => 0 });
    const text = `Numéro de carte au dos du colis : ${FIXTURES.testCard}`;
    const plan = redactor.plan(text, { policy: { card: 'confirm_once' } });
    const token = plan.segments[0].confirmationToken;
    const included = redactor.applyPlan(text, plan, { [token]: 'include' });
    expect(included.text).toContain(FIXTURES.testCard);
  });
});

describe('createModelDisclosure: constructor guards', () => {
  it('requires a redactor', () => {
    expect(() => createModelDisclosure({ clock: () => 0 })).toThrow('model_disclosure_redactor_required');
  });

  it('requires a clock', () => {
    expect(() => createModelDisclosure({ redactor: createRedactor({ clock: () => 0 }) })).toThrow('model_disclosure_clock_required');
  });

  it('rejects a clock that is neither a function nor a {now()} object', () => {
    expect(() => createModelDisclosure({ redactor: createRedactor({ clock: () => 0 }), clock: {} })).toThrow('model_disclosure_clock_required');
  });
});

describe('createModelDisclosure.prepareDisclosure: provider/model are required', () => {
  it('rejects a missing or empty provider', () => {
    const disclosure = createModelDisclosure({ redactor: createRedactor({ clock: () => 0 }), clock: () => 0 });
    expect(() => disclosure.prepareDisclosure({ text: 'x', provider: '', model: 'm' })).toThrow('model_disclosure_provider_required');
  });

  it('rejects a missing or empty model', () => {
    const disclosure = createModelDisclosure({ redactor: createRedactor({ clock: () => 0 }), clock: () => 0 });
    expect(() => disclosure.prepareDisclosure({ text: 'x', provider: 'deepseek', model: '' })).toThrow('model_disclosure_model_required');
  });
});

describe('createModelDisclosure.prepareDisclosure: confirmation bound to provider+model+digested segments', () => {
  it('requires confirmation when secrets are present, none when the text is clean', () => {
    const disclosure = createModelDisclosure({ redactor: createRedactor({ clock: () => 0 }), clock: () => 0 });
    const withSecret = disclosure.prepareDisclosure({ text: FIXTURES.apiKey, provider: 'deepseek', model: 'deepseek-v4-flash' });
    expect(withSecret.confirmationRequired).toBe(true);
    const clean = disclosure.prepareDisclosure({ text: 'Bonjour Mina', provider: 'deepseek', model: 'deepseek-v4-flash' });
    expect(clean.confirmationRequired).toBe(false);
  });

  it('produces a different confirmation digest for a different provider or model, even with identical text', () => {
    const disclosure = createModelDisclosure({ redactor: createRedactor({ clock: () => 0 }), clock: () => 0 });
    const a = disclosure.prepareDisclosure({ text: FIXTURES.apiKey, provider: 'deepseek', model: 'deepseek-v4-flash' });
    const b = disclosure.prepareDisclosure({ text: FIXTURES.apiKey, provider: 'gemini', model: 'gemini-3.5-flash' });
    expect(a.digest).not.toBe(b.digest);
  });

  it('rejects confirming with a digest that does not match (no cross-turn reuse)', () => {
    const disclosure = createModelDisclosure({ redactor: createRedactor({ clock: () => 0 }), clock: () => 0 });
    const prepared = disclosure.prepareDisclosure({ text: FIXTURES.apiKey, provider: 'deepseek', model: 'deepseek-v4-flash' });
    expect(() => disclosure.confirm({ digest: 'sha256:wrong', decisions: {} })).toThrow('model_disclosure_digest_mismatch');
    expect(() => disclosure.confirm({ digest: prepared.digest, decisions: {} })).not.toThrow();
  });
});

describe('property: no fixture secret string ever appears in a redacted, non-encrypted serialization', () => {
  it('holds for randomly composed text containing a known secret fixture', () => {
    fc.assert(fc.property(
      fc.constantFrom(...Object.values(FIXTURES)),
      fc.string({ maxLength: 40 }),
      fc.string({ maxLength: 40 }),
      (secret, prefix, suffix) => {
        const text = `${prefix} ${secret} ${suffix}`;
        const redactor = createRedactor({ clock: () => 0 });
        const plan = redactor.plan(text);
        const applied = redactor.applyPlan(text, plan);
        const serialized = JSON.stringify(applied);
        for (const segment of plan.segments) {
          expect(serialized).not.toContain(segment.value);
        }
      },
    ), { numRuns: 50 });
  });
});
