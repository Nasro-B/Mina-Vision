const CONFIRMABLE = new Set(['accepted_by_provider']);

export function createMailVerifier() {
  async function verify({ providerResult, reread } = {}) {
    if (!providerResult?.state) throw new TypeError('mail_verify_provider_result_required');
    if (typeof reread !== 'function' || !CONFIRMABLE.has(providerResult.state)) {
      return Object.freeze({ ...providerResult });
    }
    const observed = await reread();
    if (!observed?.found) return Object.freeze({ ...providerResult, state: 'failed' });
    return Object.freeze({ ...providerResult, state: 'state_confirmed' });
  }

  return Object.freeze({ verify });
}
