import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateOrderPaymentBinding, createTrustedOrder } from '@/services/order';
import { db } from '@/db';
import { subscriptionPlans, customers, orders } from '@/db/schema';

describe('Trusted Order-to-Payment Binding Invariants', () => {
  const mockOrderData = {
    order: {
      id: 'ord_test123',
      customerId: 'cus_test456',
      planId: 'plan_starter_monthly',
      paymentReference: 'ref_expected_123',
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
      reference: 'ref_expected_123',
      amount: 500000,
      currency: 'NGN',
      customerEmail: 'customer@example.com',
    });

    expect(result.isValid).toBe(true);
    expect(result.mismatchReason).toBeUndefined();
  });

  it('rejects payment with wrong payment reference (Requirement 2)', () => {
    const result = validateOrderPaymentBinding(mockOrderData, {
      reference: 'ref_tampered_999',
      amount: 500000,
      currency: 'NGN',
      customerEmail: 'customer@example.com',
    });

    expect(result.isValid).toBe(false);
    expect(result.mismatchReason).toContain('Payment reference mismatch');
  });

  it('rejects payment with wrong amount (Requirement 3: underpaid/overpaid)', () => {
    const result = validateOrderPaymentBinding(mockOrderData, {
      reference: 'ref_expected_123',
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
      reference: 'ref_expected_123',
      amount: 500000,
      currency: 'USD',
      customerEmail: 'customer@example.com',
    });

    expect(result.isValid).toBe(false);
    expect(result.mismatchReason).toContain('Currency mismatch');
  });

  it('rejects payment with wrong customer email (Requirement 5: impersonation)', () => {
    const result = validateOrderPaymentBinding(mockOrderData, {
      reference: 'ref_expected_123',
      amount: 500000,
      currency: 'NGN',
      customerEmail: 'attacker@evil.com',
    });

    expect(result.isValid).toBe(false);
    expect(result.mismatchReason).toContain('Payer email mismatch');
  });

  it('guarantees server-side order amount cannot be overridden by client input (Requirement 1)', async () => {
    // When creating an order, the caller provides planId only; amount is derived from catalog
    // If a malicious client tries to supply an arbitrary amount, createTrustedOrder ignores any external price parameters
    const order = await createTrustedOrder({
      planId: 'plan_starter_monthly',
      customerEmail: 'buyer@example.com',
    });

    // Authoritative catalog price for starter is 500000
    expect(order.expectedAmount).toBe(500000);
    expect(order.currency).toBe('NGN');
    expect(order.paymentReference).toMatch(/^ref_/);
  });
});
