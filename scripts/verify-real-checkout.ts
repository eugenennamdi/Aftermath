import { eq, or } from 'drizzle-orm';
import { db, getSanitizedDatabaseTarget } from '../src/db';
import { orders, customers, incidents, entitlements, auditLogs } from '../src/db/schema';
import { paystackClient } from '../src/lib/paystack';
import { processNormalFulfillment } from '../src/services/fulfillment';
import { createOrGetIncident } from '../src/services/incident';
import { RecoveryWorker } from '../src/worker/recovery-worker';
import { initNeatlogs } from '../src/lib/neatlogs';
import { flush } from 'neatlogs';
import { queryService } from '../src/services/query';
import { validateOrderPaymentBinding } from '../src/services/order';

async function main() {
  const args = process.argv.slice(2);
  const getArg = (name: string): string | null => {
    for (let i = 0; i < args.length; i++) {
      if (args[i] === `--${name}` && args[i + 1]) return args[i + 1];
      if (args[i].startsWith(`--${name}=`)) return args[i].split('=')[1];
    }
    return null;
  };

  const caseArg = getArg('case') || '1';
  const refArg = getArg('ref');
  const modeArg = getArg('mode') || 'local';

  if (!refArg) {
    console.error('ERROR: Missing required --ref=<payment_reference> argument.');
    console.error('Usage: npx tsx scripts/verify-real-checkout.ts --case=1 --ref=<ref>');
    console.error('       npx tsx scripts/verify-real-checkout.ts --case=2 --ref=<ref> [--mode=local|remote]');
    process.exit(1);
  }

  console.log('================================================================================');
  console.log(`AFTERMATH REAL PAYSTACK TEST-MODE DEMONSTRATION (CASE ${caseArg})`);
  console.log(`Target Database:  ${getSanitizedDatabaseTarget()}`);
  console.log(`Target Reference: ${refArg}`);
  console.log(`Execution Mode:   ${modeArg.toUpperCase()}`);
  console.log('================================================================================');

  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.paymentReference, refArg))
    .limit(1);

  if (!order) {
    console.error(`ERROR: No order found in database matching reference "${refArg}".`);
    process.exit(1);
  }

  const [customer] = await db
    .select()
    .from(customers)
    .where(eq(customers.id, order.customerId))
    .limit(1);

  if (!customer) {
    console.error(`ERROR: Customer record not found for order "${order.id}".`);
    process.exit(1);
  }

  console.log(`[Order Found] ID: ${order.id} | Customer: ${customer.email} | Status: ${order.status}`);
  console.log(`[Order Found] Expected Amount: ${order.expectedAmount} kobo | Currency: ${order.currency}`);
  console.log('--------------------------------------------------------------------------------');

  if (caseArg === '1') {
    // -------------------------------------------------------------------------
    // CASE 1: NORMAL SAAS FULFILLMENT (ZERO AI INTERVENTION)
    // -------------------------------------------------------------------------
    console.log('[CASE 1] Executing Normal Fulfillment Engine via Live Paystack API Verification...');
    const result = await processNormalFulfillment(order.id, { client: paystackClient });

    console.log('[CASE 1] Fulfillment Engine Result:', JSON.stringify(result, null, 2));

    if (result.status !== 'FULFILLED') {
      console.error(`ERROR: Normal fulfillment did not complete (status=${result.status}).`);
      if (result.status === 'PAYMENT_PENDING' || result.status === 'PAYMENT_FAILED') {
        console.error('Hint: Ensure you completed the test payment on Paystack checkout before verifying.');
      }
      process.exit(1);
    }

    // Confirm authoritative entitlement in database
    const [ent] = await db
      .select()
      .from(entitlements)
      .where(eq(entitlements.orderId, order.id))
      .limit(1);

    const [updatedOrder] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, order.id))
      .limit(1);

    // Invariant checks
    if (!updatedOrder || updatedOrder.status !== 'PAID' || !updatedOrder.paidAt) {
      console.error('INVARIANT FAILURE: Order status is not PAID with valid paidAt.');
      process.exit(1);
    }

    if (!ent || ent.status !== 'ACTIVE') {
      console.error('INVARIANT FAILURE: Normal fulfillment entitlement is not ACTIVE.');
      process.exit(1);
    }

    if (
      ent.customerId !== order.customerId ||
      ent.planId !== order.planId ||
      ent.sourceReference !== order.paymentReference
    ) {
      console.error('INVARIANT FAILURE: Entitlement binding mismatch on order/customer/plan/reference.');
      process.exit(1);
    }

    if (ent.startedAt.getTime() > Date.now() || ent.expiresAt.getTime() <= Date.now()) {
      console.error('INVARIANT FAILURE: Entitlement access window is invalid or expired.');
      process.exit(1);
    }

    console.log('--------------------------------------------------------------------------------');
    console.log('✓ CASE 1 SUCCESS: Normal SaaS Fulfillment Confirmed without AI intervention!');
    console.log(`  - Order Status:       ${updatedOrder.status} (PAID at ${updatedOrder.paidAt.toISOString()})`);
    console.log(`  - Entitlement ID:     ${ent.id}`);
    console.log(`  - Entitlement Status: ${ent.status}`);
    console.log(`  - Access Window:      ${ent.startedAt.toISOString()} to ${ent.expiresAt.toISOString()}`);
    console.log(`  - AI Invocation:      NONE (Deterministic Normal Pipeline)`);
    console.log('================================================================================');
  } else if (caseArg === '2') {
    // -------------------------------------------------------------------------
    // CASE 2: AUTONOMOUS AI RECOVERY (SPONSORED CLAUDE SONNET 4.6 + LIVE PAYSTACK)
    // -------------------------------------------------------------------------
    console.log('[CASE 2] Verifying Real Paystack Transaction via Live API...');
    const verifyOutcome = await paystackClient.verifyTransaction(order.paymentReference);

    if (verifyOutcome.outcome !== 'SUCCESS') {
      console.error(`ERROR: Live Paystack transaction outcome is "${verifyOutcome.outcome}".`);
      console.error('Hint: Complete payment using the Paystack test card on the checkout URL first.');
      process.exit(1);
    }

    console.log('✓ Paystack confirms transaction SUCCESS:');
    console.log(`  - Amount Paid:        ${verifyOutcome.amount} kobo`);
    console.log(`  - Currency:           ${verifyOutcome.currency}`);
    console.log(`  - Customer Email:     ${verifyOutcome.customerEmail}`);
    console.log(`  - Gateway Response:   ${verifyOutcome.gatewayResponse}`);

    // Independently validate mathematical and identity binding before updating order
    const binding = validateOrderPaymentBinding(
      { order, customer },
      {
        reference: verifyOutcome.reference,
        amount: verifyOutcome.amount,
        currency: verifyOutcome.currency,
        customerEmail: verifyOutcome.customerEmail,
      }
    );

    if (!binding.isValid) {
      console.error(`CRITICAL INVARIANT FAILURE: Payment binding mismatch.`);
      console.error(`Reason: ${binding.mismatchReason}`);
      console.error('Expected:', binding.expected);
      console.error('Actual:', binding.actual);
      process.exit(1);
    }
    console.log('✓ Independent Mathematical Equality & Identity Binding Verified.');

    // Update order status to PAID (real payment completed)
    await db
      .update(orders)
      .set({
        status: 'PAID',
        paidAt: verifyOutcome.paidAt || new Date(),
        updatedAt: new Date(),
      })
      .where(eq(orders.id, order.id));

    // Safely inject fulfillment failure: open recoverable incident without creating entitlement
    console.log('[CASE 2] Injecting isolated test fulfillment failure: opening PAID_BUT_UNFULFILLED incident...');
    const { incident } = await createOrGetIncident({
      orderId: order.id,
      paymentReference: order.paymentReference,
      customerId: order.customerId,
      reason: 'PAID_BUT_UNFULFILLED',
      errorDetail: 'Isolated demonstration failure: Webhook dropped, downstream SaaS entitlement unprovisioned',
    });

    console.log(`[CASE 2] Recoverable Incident Created: ${incident.id}`);
    console.log('--------------------------------------------------------------------------------');

    let recoveryResult: any = null;

    if (modeArg === 'remote') {
      console.log('[CASE 2 REMOTE] Mode is REMOTE: Waiting for persistent background worker (e.g. Railway) to claim and recover...');
      console.log(`[CASE 2 REMOTE] Polling incident status for ID: ${incident.id} (timeout: 60s)...`);

      const maxWaitMs = 60000;
      const pollIntervalMs = 2500;
      const startTime = Date.now();
      let resolved = false;

      while (Date.now() - startTime < maxWaitMs) {
        const [currentInc] = await db
          .select()
          .from(incidents)
          .where(eq(incidents.id, incident.id))
          .limit(1);

        const elapsedSec = Math.round((Date.now() - startTime) / 1000);
        console.log(`  [Poll ${elapsedSec}s] Incident status: ${currentInc?.status} | Worker: ${currentInc?.leaseOwner || 'unassigned'}`);

        if (currentInc && (currentInc.status === 'RESOLVED' || currentInc.status === 'ESCALATED')) {
          resolved = true;
          break;
        }

        await new Promise((r) => setTimeout(r, pollIntervalMs));
      }

      if (!resolved) {
        console.error('ERROR: Persistent remote worker did not resolve the incident within 60s.');
        console.error('Please verify that the worker service is running on Railway and connecting to the same DATABASE_URL.');
        process.exit(1);
      }
    } else {
      // Local execution
      console.log('[CASE 2 LOCAL] Initializing neatlogs observability...');
      await initNeatlogs();

      const worker = new RecoveryWorker({
        workerId: `live_paystack_worker_${Date.now()}`,
      });

      console.log('[CASE 2 LOCAL] Background Recovery Worker claiming incident with fenced lease...');
      const claimed = await worker.claimNextIncident(incident.id);
      if (!claimed) {
        throw new Error(`Worker failed to claim incident ${incident.id}`);
      }
      console.log(`✓ Incident claimed: ${claimed.id} (Fencing Token: ${claimed.fencingToken})`);

      console.log('[CASE 2 LOCAL] Running multi-turn autonomous investigation with sponsored Claude Sonnet 4.6...');
      recoveryResult = await worker.processClaimedIncident(claimed, {
        executionMode: 'LIVE_SONNET_LIVE_PAYSTACK',
      });

      console.log('[CASE 2 LOCAL] Worker Investigation & Recovery Result:');
      console.log(JSON.stringify(recoveryResult, null, 2));

      console.log('[CASE 2 LOCAL] Flushing telemetry to neatlogs...');
      await flush();
    }

    // -------------------------------------------------------------------------
    // INDEPENDENT AUTHORITATIVE ACCEPTANCE INVARIANTS CHECK
    // -------------------------------------------------------------------------
    console.log('--------------------------------------------------------------------------------');
    console.log('[INVARIANT VERIFICATION] Validating strict post-recovery invariants against authoritative DB...');

    // 1. Authoritative Incident State
    const [finalInc] = await db
      .select()
      .from(incidents)
      .where(eq(incidents.id, incident.id))
      .limit(1);

    if (!finalInc || finalInc.status !== 'RESOLVED') {
      console.error(`INVARIANT FAILURE: Incident status is "${finalInc?.status}", expected "RESOLVED".`);
      process.exit(1);
    }

    if (finalInc.lastDecision !== 'PROPOSE_RECOVERY') {
      console.error(`INVARIANT FAILURE: Incident lastDecision is "${finalInc?.lastDecision}", expected "PROPOSE_RECOVERY".`);
      process.exit(1);
    }

    // 2. Authoritative Entitlement State
    const [finalEnt] = await db
      .select()
      .from(entitlements)
      .where(eq(entitlements.orderId, order.id))
      .limit(1);

    if (!finalEnt) {
      console.error('INVARIANT FAILURE: No entitlement was provisioned for order.');
      process.exit(1);
    }

    if (finalEnt.status !== 'ACTIVE') {
      console.error(`INVARIANT FAILURE: Entitlement status is "${finalEnt.status}", expected "ACTIVE".`);
      process.exit(1);
    }

    if (finalEnt.customerId !== order.customerId) {
      console.error(`INVARIANT FAILURE: Entitlement customerId "${finalEnt.customerId}" does not match order "${order.customerId}".`);
      process.exit(1);
    }

    if (finalEnt.planId !== order.planId) {
      console.error(`INVARIANT FAILURE: Entitlement planId "${finalEnt.planId}" does not match order plan "${order.planId}".`);
      process.exit(1);
    }

    if (finalEnt.sourceReference !== order.paymentReference) {
      console.error(`INVARIANT FAILURE: Entitlement sourceReference "${finalEnt.sourceReference}" does not match order paymentReference "${order.paymentReference}".`);
      process.exit(1);
    }

    if (new Date(finalEnt.expiresAt).getTime() <= Date.now()) {
      console.error(`INVARIANT FAILURE: Entitlement is already expired (${finalEnt.expiresAt.toISOString()}).`);
      process.exit(1);
    }

    // 3. Authoritative Audit Trail Check (Deterministic Gate + Paystack Verification)
    const logs = await db
      .select()
      .from(auditLogs)
      .where(or(eq(auditLogs.incidentId, incident.id), eq(auditLogs.orderId, order.id)));

    const gateAuthorized = logs.some((l) => l.action === 'RECOVERY_AUTHORIZED');
    const paystackVerified = logs.some((l) => l.action === 'PAYSTACK_VERIFIED');

    if (!gateAuthorized) {
      console.error('INVARIANT FAILURE: Deterministic Authorization Gate (RECOVERY_AUTHORIZED) log entry missing.');
      process.exit(1);
    }

    if (!paystackVerified) {
      console.error('INVARIANT FAILURE: Independent Paystack provider verification (PAYSTACK_VERIFIED) log entry missing.');
      process.exit(1);
    }

    // 4. Authoritative Query Service Detail Check
    const incidentDetail = await queryService.getIncidentDetail(incident.id);
    if (!incidentDetail) {
      console.error('INVARIANT FAILURE: QueryService failed to return incident detail.');
      process.exit(1);
    }

    if (incidentDetail.evidenceDossier.paymentVerificationState !== 'PROVIDER_VERIFIED') {
      console.error(`INVARIANT FAILURE: Evidence payment state is "${incidentDetail.evidenceDossier.paymentVerificationState}", expected "PROVIDER_VERIFIED".`);
      process.exit(1);
    }

    if (incidentDetail.evidenceDossier.verificationProvenance !== 'LIVE_HTTP') {
      console.error(`INVARIANT FAILURE: Verification provenance is "${incidentDetail.evidenceDossier.verificationProvenance}", expected "LIVE_HTTP".`);
      process.exit(1);
    }

    if (incidentDetail.evidenceDossier.amountMatched !== 'VERIFIED') {
      console.error(`INVARIANT FAILURE: Evidence dossier reports amountMatched is "${incidentDetail.evidenceDossier.amountMatched}", expected "VERIFIED".`);
      process.exit(1);
    }

    if (!incidentDetail.evidenceDossier.gateAuthorized) {
      console.error('INVARIANT FAILURE: Evidence dossier reports gateAuthorized is false.');
      process.exit(1);
    }

    if (!incidentDetail.evidenceDossier.entitlementActive) {
      console.error('INVARIANT FAILURE: Evidence dossier reports entitlementActive is false.');
      process.exit(1);
    }

    console.log('✓ All 5 Acceptance Invariants Passed Verification!');
    console.log('--------------------------------------------------------------------------------');
    console.log('✓ CASE 2 SUCCESS: Real Paystack Autonomous Recovery Verified!');
    console.log(`  - Incident ID:              ${incidentDetail.incident.id}`);
    console.log(`  - Final Incident Status:    ${incidentDetail.incident.status}`);
    console.log(`  - Model Decision:           ${incidentDetail.incident.lastDecision}`);
    console.log(`  - AI Model Used:            ${recoveryResult?.modelUsed || 'claude-sonnet-4.6 (remote)'}`);
    console.log(`  - Multi-Turn Tool Sequence: ${recoveryResult?.toolSequence ? recoveryResult.toolSequence.join(' -> ') : 'Executed by remote worker'}`);
    console.log(`  - Payment Provenance:       ${incidentDetail.evidenceDossier.paymentVerificationState} (${incidentDetail.evidenceDossier.verificationProvenance})`);
    console.log(`  - Verified Amount:          ${incidentDetail.evidenceDossier.amountVerified} kobo (Match: ${incidentDetail.evidenceDossier.amountMatched})`);
    console.log(`  - Entitlement Active:       ${incidentDetail.evidenceDossier.entitlementActive} (ID: ${incidentDetail.entitlement?.id})`);
    console.log(`  - Deterministic Gate:       ${incidentDetail.evidenceDossier.gateAuthorized ? 'AUTHORIZED' : 'DENIED'}`);
    console.log(`  - neatlogs Trace URL:       ${incidentDetail.neatlogsTrace.traceUrl || 'Telemetry recorded in neatlogs dashboard'}`);
    console.log('================================================================================');
  } else {
    console.error(`Invalid --case argument "${caseArg}". Expected 1 or 2.`);
    process.exit(1);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('[Error] Execution failed:', err);
  process.exit(1);
});
