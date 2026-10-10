import { describe, it, expect, vi } from 'vitest';
import {
  validateOrderPaymentBinding,
  createTrustedOrder,
  resolveSafeCallbackUrl,
} from '@/services/order';
import { isValidPaystackReference, generatePaystackReference, PaystackClient } from '@/lib/paystack';

describe('Trusted Order-to-Payment Binding Invariants', () => {
  const mockOrderData = {
    order: {
      id: 'ord_test123',
      customerId: 'cus_test456',
      planId: 'plan_starter_monthly',
      paymentReference: 'ref-expected-123',
      expectedAmount: 500000, // 5,000 NGN in kobo
      currency: 'NGN',
      status: 'PENDING',
      paystackAccessCode: null,
      paystackAuthorizationUrl: null,
      paidAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    customer: {
      id: 'cus_test456',
      email: 'customer@example.com',
      name: 'Test Customer',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };

  it('validates true when reference, amount, currency, and customer email match exactly', () => {
    const result = validateOrderPaymentBinding(mockOrderData, {
      reference: 'ref-expected-123',
      amount: 500000,
      currency: 'NGN',
      customerEmail: 'customer@example.com',
    });

    expect(result.isValid).toBe(true);
    expect(result.mismatchReason).toBeUndefined();
  });

  it('rejects payment with wrong payment reference (Requirement 2)', () => {
    const result = validateOrderPaymentBinding(mockOrderData, {
      reference: 'ref-tampered-999',
      amount: 500000,
      currency: 'NGN',
      customerEmail: 'customer@example.com',
    });

    expect(result.isValid).toBe(false);
    expect(result.mismatchReason).toContain('Payment reference mismatch');
  });

  it('rejects payment with wrong amount (Requirement 3: underpaid/overpaid)', () => {
    const result = validateOrderPaymentBinding(mockOrderData, {
      reference: 'ref-expected-123',
      amount: 100000, // 1,000 NGN instead of 5,000 NGN
      currency: 'NGN',
      customerEmail: 'customer@example.com',
    });

    expect(result.isValid).toBe(false);
    expect(result.mismatchReason).toContain('Payment amount mismatch');
    expect(result.mismatchReason).toContain('500000');
    expect(result.mismatchReason).toContain('100000');
  });

  it('rejects payment with wrong currency (Requirement 4: e.g. USD instead of NGN)', () => {
    const result = validateOrderPaymentBinding(mockOrderData, {
      reference: 'ref-expected-123',
      amount: 500000,
      currency: 'USD',
      customerEmail: 'customer@example.com',
    });

    expect(result.isValid).toBe(false);
    expect(result.mismatchReason).toContain('Currency mismatch');
  });

  it('rejects payment with wrong customer email (Requirement 5: impersonation)', () => {
    const result = validateOrderPaymentBinding(mockOrderData, {
      reference: 'ref-expected-123',
      amount: 500000,
      currency: 'NGN',
      customerEmail: 'attacker@evil.com',
    });

    expect(result.isValid).toBe(false);
    expect(result.mismatchReason).toContain('Payer email mismatch');
  });

  it('guarantees server-side order amount cannot be overridden by client input (Requirement 1)', async () => {
    const order = await createTrustedOrder({
      planId: 'plan_starter_monthly',
      customerEmail: 'buyer@example.com',
    });

    // Authoritative catalog price for starter is 500000
    expect(order.expectedAmount).toBe(500000);
    expect(order.currency).toBe('NGN');
    expect(order.paymentReference).toMatch(/^ref-/);
  });

  it('generates Paystack-compatible references strictly matching [a-zA-Z0-9.-=]+ without underscores (Regression Check 1)', () => {
    const ref = generatePaystackReference();
    expect(isValidPaystackReference(ref)).toBe(true);
    expect(ref).not.toContain('_'); // Zero underscores allowed
    expect(/^[a-zA-Z0-9.\-=]+$/.test(ref)).toBe(true);
  });

  it('rejects initialization when Paystack echoes a mismatched reference (Regression Check 2)', async () => {
    const mockPaystackClient = new PaystackClient('sk_test_mock_123', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: true,
        message: 'Initialized',
        data: {
          authorization_url: 'https://checkout.paystack.com/fake',
          access_code: 'acc_fake',
          reference: 'ref-different-tampered-reference', // Echoed different reference!
        },
      }),
    } as unknown as Response));

    await expect(
      createTrustedOrder({
        planId: 'plan_starter_monthly',
        customerEmail: 'tamper@example.com',
        paystack: mockPaystackClient,
      })
    ).rejects.toThrow(/reference mismatch/i);
  });

  it('protects against open-redirect callback URLs by restricting to trusted origin (Regression Check 10)', () => {
    process.env.APP_BASE_URL = 'http://localhost:3000';

    // 1. Phishing / untrusted domain must fall back to safe default
    const evilRedirect = resolveSafeCallbackUrl('https://evil-phishing.com/steal-creds');
    expect(evilRedirect).toBe('http://localhost:3000/checkout/complete');

    // 2. Relative paths allowed and anchored to app base
    const relativeRedirect = resolveSafeCallbackUrl('/checkout/success');
    expect(relativeRedirect).toBe('http://localhost:3000/checkout/success');

    // 3. Trusted same-origin URL accepted
    const trustedRedirect = resolveSafeCallbackUrl('http://localhost:3000/my-account');
    expect(trustedRedirect).toBe('http://localhost:3000/my-account');
  });
});
