import { canonicalJson } from '../crypto/canonical-json.mjs';
import { sha256 } from '../crypto/digest.mjs';

export function createModelDisclosure({ redactor, clock } = {}) {
  if (!redactor?.plan || !redactor?.applyPlan) throw new TypeError('model_disclosure_redactor_required');
  if (!clock || (typeof clock !== 'function' && typeof clock.now !== 'function')) throw new TypeError('model_disclosure_clock_required');
  const now = () => Number(typeof clock === 'function' ? clock() : clock.now());
  const pending = new Map();

  return Object.freeze({
    // Confirmation is bound to provider+model+the exact digested segment plan — never a bare
    // yes/no on raw text — so a token issued for one provider/model/turn can never authorize
    // disclosure to a different one, even with byte-identical input text.
    prepareDisclosure({ text, provider, model }) {
      if (typeof provider !== 'string' || provider.length === 0) throw new TypeError('model_disclosure_provider_required');
      if (typeof model !== 'string' || model.length === 0) throw new TypeError('model_disclosure_model_required');
      const plan = redactor.plan(text);
      const digestInput = {
        provider, model,
        segments: plan.segments.map((segment) => ({ type: segment.type, start: segment.start, end: segment.end, strategy: segment.strategy })),
      };
      const digest = `sha256:${sha256(canonicalJson(digestInput))}`;
      pending.set(digest, { text, plan, provider, model });
      return Object.freeze({
        digest, provider, model,
        confirmationRequired: plan.segments.length > 0,
        segments: plan.segments,
        preparedAt: new Date(now()).toISOString(),
      });
    },

    // Single-use: the matching prepared disclosure is consumed on confirm, exactly like an approval
    // token — a stale or foreign digest is rejected outright, never silently reused.
    confirm({ digest, decisions = {} }) {
      const entry = pending.get(digest);
      if (!entry) throw new Error('model_disclosure_digest_mismatch');
      pending.delete(digest);
      const applied = redactor.applyPlan(entry.text, entry.plan, decisions);
      return Object.freeze({ text: applied.text, provider: entry.provider, model: entry.model, confirmedAt: new Date(now()).toISOString() });
    },
  });
}
