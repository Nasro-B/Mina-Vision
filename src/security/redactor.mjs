import { randomUUID } from 'node:crypto';
import { classifySecrets } from './secret-classifier.mjs';

// Secrets/credentials never survive in any form; IBAN/card are shown masked (useful for the owner
// to recognize which one, never enough to reuse); anything else defaults to a one-shot confirmation.
const DEFAULT_POLICY = Object.freeze({
  jwt: 'omit', api_key: 'omit', telegram_token: 'omit', password: 'omit', env_secret: 'omit', otp: 'omit',
  iban: 'mask', card: 'mask',
});

function maskFor(type, value) {
  return `[${type.toUpperCase()}:${'•'.repeat(Math.min(8, value.length))}]`;
}

export function createRedactor({ clock } = {}) {
  if (!clock || (typeof clock !== 'function' && typeof clock.now !== 'function')) throw new TypeError('redactor_clock_required');
  const now = () => Number(typeof clock === 'function' ? clock() : clock.now());
  const consumedTokens = new Set();

  return Object.freeze({
    plan(text, { policy = {} } = {}) {
      const mergedPolicy = { ...DEFAULT_POLICY, ...policy };
      const matches = classifySecrets(text);
      const segments = matches.map((match) => {
        // classifySecrets only ever produces the 8 types DEFAULT_POLICY already covers, so this is
        // never undefined — no fallback needed for a type that structurally cannot occur.
        const strategy = mergedPolicy[match.type];
        return Object.freeze({
          ...match, strategy,
          confirmationToken: strategy === 'confirm_once' ? randomUUID() : null,
        });
      });
      return Object.freeze({ text, segments: Object.freeze(segments), plannedAt: new Date(now()).toISOString() });
    },

    // Applies from the last segment backwards so earlier offsets stay valid as replacements change length.
    applyPlan(text, plan, decisions = {}) {
      if (plan.text !== text) throw new Error('redactor_plan_text_mismatch');
      let result = text;
      const ordered = [...plan.segments].sort((a, b) => b.start - a.start);
      for (const segment of ordered) {
        let replacement;
        if (segment.strategy === 'omit') {
          replacement = '[omitted]';
        } else if (segment.strategy === 'mask') {
          replacement = maskFor(segment.type, segment.value);
        } else {
          if (consumedTokens.has(segment.confirmationToken)) throw new Error('redactor_confirmation_already_consumed');
          const decision = decisions[segment.confirmationToken];
          consumedTokens.add(segment.confirmationToken);
          replacement = decision === 'include' ? segment.value : '[omitted]';
        }
        result = result.slice(0, segment.start) + replacement + result.slice(segment.end);
      }
      return Object.freeze({ text: result, appliedAt: new Date(now()).toISOString() });
    },
  });
}
