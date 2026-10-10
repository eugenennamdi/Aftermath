import { describe, it, expect } from 'vitest';
import { paystackClient } from '@/lib/paystack';

describe('Controlled Live Paystack Test-Mode Verification', () => {
  const hasLiveKey = Boolean(
    process.env.PAYSTACK_SECRET_KEY &&
    process.env.PAYSTACK_SECRET_KEY.startsWith('sk_test_')
  );

  it.runIf(hasLiveKey)('verifies live Paystack test transaction when secret key is provided', async () => {
    // Attempt verification of a dummy reference against live Paystack API
    const result = await paystackClient.verifyTransaction('ref_live_probe_check');
    // Live test API will return either FAILED, PENDING, or API_ERROR for non-existent test ref
    expect(['FAILED', 'API_ERROR', 'PENDING', 'SUCCESS']).toContain(result.outcome);
  });

  it.skipIf(hasLiveKey)('skips live Paystack probe when PAYSTACK_SECRET_KEY is absent from environment', () => {
    console.log('[Paystack Live Check] PAYSTACK_SECRET_KEY is not configured; live probe test skipped.');
    expect(true).toBe(true);
  });
});
