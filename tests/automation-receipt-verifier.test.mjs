import { describe, expect, it } from 'vitest';
import { createReceiptVerifier } from '../src/automation/receipt-verifier.mjs';

describe('automation receipt verifier', () => {
  it('fails closed on an explicitly unverified effect even when no expected effect was supplied', async () => {
    const result = await createReceiptVerifier().verify({
      action: { capability: 'home:execute' },
      receipt: {
        receiptId: 'receipt-1',
        capability: 'home:execute',
        effect: { executed: false, verified: false },
      },
    });

    expect(result).toMatchObject({ confirmed: false, reason: 'effet_attendu_non_prouve' });
  });
});
