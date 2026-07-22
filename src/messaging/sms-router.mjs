import { deliveryKeyFor } from './message-delivery-ledger.mjs';

const VALID_MODES = new Set(['native-first', 'httpsms-first', 'native-only', 'httpsms-only']);

function orderedProviders(mode, nativeProvider, httpsmsProvider) {
  if (mode === 'native-only') return [nativeProvider];
  if (mode === 'httpsms-only') return [httpsmsProvider];
  if (mode === 'httpsms-first') return [httpsmsProvider, nativeProvider];
  return [nativeProvider, httpsmsProvider];
}

// Routes an SMS send across the native (Huawei ADB) provider and the httpSMS protocol adapter.
// "Reconciles by requestId first" — a request already accepted by EITHER provider in a previous
// call is never resent, even if this call arrives via a different mode; only falls through to
// the second provider when the first genuinely did not accept the message (rejected or crashed).
export function createSmsRouter({ nativeProvider, httpsmsProvider, mode = 'native-first', ledger } = {}) {
  if (!VALID_MODES.has(mode)) throw new TypeError(`sms_router_mode_invalid:${mode}`);
  if (!ledger?.claim || !ledger?.get || !ledger?.setState || !ledger?.markDeadLetter) {
    throw new TypeError('sms_router_ledger_required');
  }

  async function send({ requestId, from, to, content }) {
    const key = deliveryKeyFor({ channel: 'sms-outbound', deviceId: 'router', messageId: requestId });
    const claimed = ledger.claim(key);
    if (claimed.state === 'sent' || claimed.state === 'acked') return JSON.parse(claimed.replyText);

    const providers = orderedProviders(mode, nativeProvider, httpsmsProvider).filter(Boolean);
    const attempts = [];
    for (const provider of providers) {
      try {
        const result = await provider.send({ from, to, content, requestId });
        if (result?.accepted) {
          ledger.setState(key, 'sent', { replyText: JSON.stringify(result), providerMessageId: result.providerMessageId ?? null });
          return result;
        }
        attempts.push(`${provider.id}:not_accepted`);
      } catch (error) {
        attempts.push(`${provider.id}:${error.message}`);
      }
    }
    ledger.markDeadLetter(key, attempts.join(', '));
    throw new Error(`sms_router_all_providers_failed:${attempts.join(', ')}`);
  }

  return Object.freeze({ send, mode });
}
