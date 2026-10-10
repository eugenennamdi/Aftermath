import { describe, it, expect } from 'vitest';
import { paystackClient, type PaystackVerificationAdapter } from '@/lib/paystack';
import { RecoveryWorker } from '@/worker/recovery-worker';
import { investigateIncident, type LLMMockTransport } from '@/agent/investigator';

describe('Scoped Paystack Verification Adapter Isolation & Concurrency Safety', () => {
  it('guarantees scoped adapter does not mutate global paystackClient', async () => {
    const originalHasKey = paystackClient.hasSecretKey;
    const originalVerify = paystackClient.verifyTransaction;

    const customAdapter: PaystackVerificationAdapter = {
      hasSecretKey: () => true,
      verifyTransaction: async (ref: string) => ({
        outcome: 'SUCCESS',
        reference: ref,
        amount: 888888,
        currency: 'USD',
        customerEmail: 'custom@isolated.io',
        paidAt: new Date(),
        rawData: {},
      }),
    };

    const worker = new RecoveryWorker({
      workerId: 'worker_isolation_test_1',
      paystackAdapter: customAdapter,
    });

    // Verify worker has custom adapter
    const workerStatus = worker.getStatus();
    expect(workerStatus.workerId).toBe('worker_isolation_test_1');

    // Crucial check: global paystackClient functions were NOT modified
    expect(paystackClient.hasSecretKey).toBe(originalHasKey);
    expect(paystackClient.verifyTransaction).toBe(originalVerify);
  });

  it('proves concurrent operations with different adapters execute in complete isolation', async () => {
    const adapterA: PaystackVerificationAdapter = {
      hasSecretKey: () => true,
      verifyTransaction: async (ref: string) => ({
        outcome: 'SUCCESS',
        reference: ref,
        amount: 100000,
        currency: 'NGN',
        customerEmail: 'user_a@test.com',
        paidAt: new Date(),
        rawData: {},
      }),
    };

    const adapterB: PaystackVerificationAdapter = {
      hasSecretKey: () => true,
      verifyTransaction: async (ref: string) => ({
        outcome: 'SUCCESS',
        reference: ref,
        amount: 200000,
        currency: 'USD',
        customerEmail: 'user_b@test.com',
        paidAt: new Date(),
        rawData: {},
      }),
    };

    const mockTransportA: LLMMockTransport = async (turn) => {
      if (turn === 1) {
        return {
          functionCalls: [{ name: 'verify_paystack_transaction', args: { paymentReference: 'ref_a' } }],
        };
      }
      return {
        functionCalls: [{ name: 'submit_investigation_decision', args: { decision: 'PROPOSE_RECOVERY', summary: 'Done A' } }],
      };
    };

    const mockTransportB: LLMMockTransport = async (turn) => {
      if (turn === 1) {
        return {
          functionCalls: [{ name: 'verify_paystack_transaction', args: { paymentReference: 'ref_b' } }],
        };
      }
      return {
        functionCalls: [{ name: 'submit_investigation_decision', args: { decision: 'ESCALATE', summary: 'Done B' } }],
      };
    };

    // Run both investigations concurrently
    const [resultA, resultB] = await Promise.all([
      investigateIncident('inc_a', 'ord_a', 'ref_a', {
        paystackAdapter: adapterA,
        mockTransport: mockTransportA,
      }),
      investigateIncident('inc_b', 'ord_b', 'ref_b', {
        paystackAdapter: adapterB,
        mockTransport: mockTransportB,
      }),
    ]);

    // Investigation A received evidence from Adapter A
    expect((resultA.evidence.paystack as any)?.amount).toBe(100000);
    expect((resultA.evidence.paystack as any)?.currency).toBe('NGN');
    expect((resultA.evidence.paystack as any)?.customerEmail).toBe('user_a@test.com');

    // Investigation B received evidence from Adapter B
    expect((resultB.evidence.paystack as any)?.amount).toBe(200000);
    expect((resultB.evidence.paystack as any)?.currency).toBe('USD');
    expect((resultB.evidence.paystack as any)?.customerEmail).toBe('user_b@test.com');

    // Neither leaked into the other
    expect((resultA.evidence.paystack as any)?.amount).not.toBe((resultB.evidence.paystack as any)?.amount);
  });
});
