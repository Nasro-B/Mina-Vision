import { describe, expect, it } from 'vitest';
import { DISCLOSURE_BASE_TEXT, createCallDisclosure } from '../src/telephony/call-disclosure.mjs';

describe('call-disclosure (§8.3, §17 — gate RGPD)', () => {
  it('SANS validation juridique, Mina ne peut pas diffuser le message (gate §17)', () => {
    const d = createCallDisclosure(); // legallyValidated par défaut = false
    expect(d.legallyValidated).toBe(false);
    expect(d.canGoLive()).toBe(false);
    expect(() => d.disclosureText()).toThrow('call_disclosure_not_legally_validated');
  });

  it('APRÈS validation, le texte de base §8.3 est diffusable', () => {
    const d = createCallDisclosure({ legallyValidated: true });
    expect(d.canGoLive()).toBe(true);
    const text = d.disclosureText();
    expect(text).toBe(DISCLOSURE_BASE_TEXT);
    // Les garanties RGPD clés sont présentes (audio non conservé, refus possible).
    expect(text).toMatch(/audio n.est pas conserv/iu);
    expect(text).toMatch(/refuser/iu);
  });

  it('consentement accordé → on continue', () => {
    const d = createCallDisclosure({ legallyValidated: true });
    expect(d.recordConsent('oui')).toMatchObject({ consent: 'granted', outcome: 'proceed' });
  });

  it('refus → terminer sans rien conserver (§8.5)', () => {
    const d = createCallDisclosure({ legallyValidated: true });
    expect(d.recordConsent('non')).toMatchObject({ consent: 'refused', outcome: 'end_no_retention' });
  });

  it('numéro caller ID : proposé ≠ confirmé bloque, égal confirme (§8.4)', () => {
    const d = createCallDisclosure({ legallyValidated: true });
    expect(d.callerIdConfirmed('+33612345678', '+33600000000')).toBe(false);
    expect(d.callerIdConfirmed('+33612345678', '+33612345678')).toBe(true);
    expect(d.callerIdConfirmed('+33612345678', null)).toBe(false);
  });
});
