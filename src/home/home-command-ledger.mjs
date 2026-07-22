import { randomUUID } from 'node:crypto';

export function createSmartHomeCommandId() {
  return randomUUID();
}

export function createSmartHomeCommandLedger({ now = Date.now } = {}) {
  const entries = new Map();

  function begin({ commandId, expiresAt, action } = {}) {
    if (typeof commandId !== 'string' || commandId.length < 1) throw new TypeError('smart_home_command_id_invalid');
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= now()) throw new Error('smart_home_command_expired');

    const existing = entries.get(commandId);
    if (existing) {
      if (action !== undefined && existing.action !== undefined && existing.action !== action) {
        throw new Error('smart_home_command_action_mismatch');
      }
      if (existing.status === 'pending') return Object.freeze({ status: 'pending' });
      return Object.freeze({ status: 'duplicate', receipt: existing.receipt });
    }
    entries.set(commandId, { status: 'pending', action });
    return Object.freeze({ status: 'new' });
  }

  function finish(commandId, receipt) {
    const existing = entries.get(commandId);
    const frozenReceipt = Object.freeze({ ...receipt });
    entries.set(commandId, { status: 'done', action: existing?.action, receipt: frozenReceipt });
    return frozenReceipt;
  }

  function getReceipt(commandId) {
    return entries.get(commandId)?.receipt ?? null;
  }

  return Object.freeze({ begin, finish, getReceipt });
}
