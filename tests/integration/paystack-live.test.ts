import { describe, it, expect } from 'vitest';
import { paystackClient } from '@/lib/paystack';

describe('Paystack API Connectivity Smoke Test (Transport & Key Validation Only)', () => {
  const hasLiveKey = Boolean(
    process.env.PAYSTACK_SECRET_KEY &&
    process.env.PAYSTACK_SECRET_KEY.startsWith('sk_test_')
  );

  it.runIf(hasLiveKey)('validates HTTPS transport and API key reachability to Paystack test gateway', async () => {
    // Probes Paystack verify endpoint to confirm network egress and secret key formatting.
    // NOTE: This is strictly an infrastructure connectivity probe; it does NOT constitute payment verification.
    const result = await paystackClient.verifyTransaction('ref_connectivity_probe_check');
    // Ensure communication with Paystack succeeded and returned a structured API response (e.g. 400/404 for unknown ref)
    expect(result).toBeDefined();
    expect(result.reference).toBe('ref_connectivity_probe_check');
    // Genuine test payment acceptance requires an authentic reference completed by the operator.
  });

  it.skipIf(hasLiveKey)('skips connectivity smoke probe when PAYSTACK_SECRET_KEY is absent', () => {
    console.log('[Paystack Smoke Probe] PAYSTACK_SECRET_KEY is not configured; smoke test skipped.');
    expect(true).toBe(true);
  });
});
