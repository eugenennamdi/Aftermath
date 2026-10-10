import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { orders, customers } from '@/db/schema';
import { paystackClient } from '@/lib/paystack';
import { validateOrderPaymentBinding } from '@/services/order';

describe('Real Paystack Test-Mode Payment Acceptance Gate', () => {
  const realReference = process.env.PAYSTACK_REAL_TEST_REFERENCE;
  const hasRealReference = Boolean(realReference && realReference.trim().length > 0);

  it.runIf(hasRealReference)(
    'strictly validates completed real Paystack test transaction against authoritative local order binding',
    async () => {
      const reference = realReference!.trim();

      // 1. Fetch trusted order bound prior to checkout
      const [order] = await db
        .select()
        .from(orders)
        .where(eq(orders.paymentReference, reference))
        .limit(1);

      expect(order).toBeDefined();
      expect(order.id).toBeDefined();

      // 2. Fetch customer bound to order
      const [customer] = await db
        .select()
        .from(customers)
        .where(eq(customers.id, order.customerId))
        .limit(1);

      expect(customer).toBeDefined();

      // 3. Query authoritative live Paystack API for independent verification
      const verification = await paystackClient.verifyTransaction(reference);

      // STRICT RELEASE REQUIREMENT: Must be SUCCESS; never API_ERROR, FAILED, or PENDING
      expect(verification.outcome).toBe('SUCCESS');

      if (verification.outcome !== 'SUCCESS') {
        throw new Error(`Real payment verification failed with outcome: ${verification.outcome}`);
      }

      // 4. Exact mathematical equality & customer identity binding
      expect(verification.reference).toBe(order.paymentReference);
      expect(verification.amount).toBe(order.expectedAmount);
      expect(verification.currency.toUpperCase()).toBe(order.currency.toUpperCase());
      expect(verification.customerEmail.toLowerCase()).toBe(customer.email.toLowerCase());

      // 5. Order binding invariant check
      const binding = validateOrderPaymentBinding(
        { order, customer },
        {
          reference: verification.reference,
          amount: verification.amount,
          currency: verification.currency,
          customerEmail: verification.customerEmail,
        }
      );

      expect(binding.isValid).toBe(true);
      expect(binding.mismatchReason).toBeUndefined();
    }
  );

  it.skipIf(hasRealReference)(
    'skips real payment acceptance gate until operator provides a completed PAYSTACK_REAL_TEST_REFERENCE',
    () => {
      console.log(
        '[Paystack Real Acceptance] PAYSTACK_REAL_TEST_REFERENCE not set. Complete a real checkout via Paystack test mode to execute this acceptance test.'
      );
      expect(true).toBe(true);
    }
  );
});
