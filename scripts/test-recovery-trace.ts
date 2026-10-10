import crypto from 'node:crypto';
import { db } from '../src/db';
import { customers, orders, incidents } from '../src/db/schema';
import { RecoveryWorker } from '../src/worker/recovery-worker';
import { createOrGetIncident } from '../src/services/incident';
import { generatePaystackReference, paystackClient } from '../src/lib/paystack';
import { initNeatlogs } from '../src/lib/neatlogs';
import { flush } from 'neatlogs';

async function runRealRecoveryWorkflow() {
  console.log('[RecoveryTrace] Initializing neatlogs with live project credentials...');
  await initNeatlogs();

  const customerId = `cus-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const customerEmail = `real-trace-${Date.now()}@example.com`;
  const orderId = `ord-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const reference = generatePaystackReference();

  console.log('[RecoveryTrace] Creating test customer, order, and incident in PostgreSQL...');
  await db.insert(customers).values({
    id: customerId,
    email: customerEmail,
    name: 'Live Neatlogs Trace User',
  });

  await db.insert(orders).values({
    id: orderId,
    customerId,
    planId: 'plan_starter_monthly',
    paymentReference: reference,
    expectedAmount: 500000, // 5,000 NGN
    currency: 'NGN',
    status: 'PAID',
    paidAt: new Date(),
  });

  const { incident } = await createOrGetIncident({
    orderId,
    paymentReference: reference,
    customerId,
    reason: 'PAID_BUT_UNFULFILLED',
  });

  console.log(`[RecoveryTrace] Incident created: ${incident.id}`);

  // Mock Paystack verification response matching order
  const originalVerify = paystackClient.verifyTransaction.bind(paystackClient);
  const originalHasSecretKey = paystackClient.hasSecretKey.bind(paystackClient);

  paystackClient.hasSecretKey = () => true;
  paystackClient.verifyTransaction = async (ref: string) => ({
    outcome: 'SUCCESS',
    reference: ref,
    amount: 500000,
    currency: 'NGN',
    customerEmail,
    paidAt: new Date(),
    gatewayResponse: 'Successful',
    rawData: { status: 'success' },
  });

  const worker = new RecoveryWorker({ workerId: `real_trace_worker_${Date.now()}` });

  const EXECUTION_MODE = 'LIVE_SONNET_SIMULATED_PAYSTACK';
  console.log(`[RecoveryTrace] Execution Mode: ${EXECUTION_MODE}`);
  console.log('[RecoveryTrace] Model Provider: Claude Sonnet 4.6 (LiteLLM Sponsored Gateway)');
  console.log('[RecoveryTrace] Payment Gateway: Paystack Test Mode (Simulated Success Fixture for Deterministic Order Matching)');

  // Claim the incident
  const claimed = await worker.claimNextIncident(incident.id);
  if (!claimed) {
    throw new Error('Failed to claim incident');
  }
  console.log(`[RecoveryTrace] Claimed incident ${claimed.id} with fencing token ${claimed.fencingToken}`);

  console.log('[RecoveryTrace] Executing recovery workflow with live Claude Sonnet 4.6 model via LiteLLM...');
  const result = await worker.processClaimedIncident(claimed, {
    executionMode: EXECUTION_MODE,
  });

  console.log('[RecoveryTrace] Recovery workflow finished:', JSON.stringify(result, null, 2));

  console.log('[RecoveryTrace] Flushing telemetry to neatlogs backend...');
  await flush();
  console.log('[RecoveryTrace] Flush completed successfully!');

  // Reset paystackClient
  paystackClient.verifyTransaction = originalVerify;
  paystackClient.hasSecretKey = originalHasSecretKey;

  process.exit(0);
}

runRealRecoveryWorkflow().catch((err) => {
  console.error('[RecoveryTrace] Error:', err);
  process.exit(1);
});
