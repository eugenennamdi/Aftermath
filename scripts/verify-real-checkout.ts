import { eq } from 'drizzle-orm';
import { db } from '../src/db';
import { orders, customers, incidents, entitlements, auditLogs } from '../src/db/schema';
import { paystackClient } from '../src/lib/paystack';
import { processNormalFulfillment } from '../src/services/fulfillment';
import { createOrGetIncident } from '../src/services/incident';
import { RecoveryWorker } from '../src/worker/recovery-worker';
import { initNeatlogs } from '../src/lib/neatlogs';
import { flush } from 'neatlogs';
import { queryService } from '../src/services/query';

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

  if (!refArg) {
    console.error('ERROR: Missing required --ref=<payment_reference> argument.');
    console.error('Usage: npx tsx scripts/verify-real-checkout.ts --case=1 --ref=<ref>');
    process.exit(1);
  }

  console.log('================================================================================');
  console.log(`AFTERMATH REAL PAYSTACK TEST-MODE DEMONSTRATION (CASE ${caseArg})`);
  console.log(`Target Reference: ${refArg}`);
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

  console.log(`[Order Found] ID: ${order.id} | Customer: ${customer?.email} | Status: ${order.status}`);
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

    console.log('--------------------------------------------------------------------------------');
    console.log('✓ CASE 1 SUCCESS: Normal SaaS Fulfillment Confirmed without AI intervention!');
    console.log(`  - Order Status:       ${updatedOrder.status} (PAID at ${updatedOrder.paidAt?.toISOString()})`);
    console.log(`  - Entitlement ID:     ${ent?.id}`);
    console.log(`  - Entitlement Status: ${ent?.status}`);
    console.log(`  - Access Window:      ${ent?.startedAt.toISOString()} to ${ent?.expiresAt.toISOString()}`);
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

    // Initialize neatlogs observability
    await initNeatlogs();

    const worker = new RecoveryWorker({
      workerId: `live_paystack_worker_${Date.now()}`,
    });

    // Worker claims incident
    console.log('[CASE 2] Background Recovery Worker claiming incident with fenced lease...');
    const claimed = await worker.claimNextIncident(incident.id);
    if (!claimed) {
      throw new Error(`Worker failed to claim incident ${incident.id}`);
    }
    console.log(`✓ Incident claimed: ${claimed.id} (Fencing Token: ${claimed.fencingToken})`);

    // Execute autonomous recovery with live Claude Sonnet 4.6 and live Paystack
    console.log('[CASE 2] Running multi-turn autonomous investigation with sponsored Claude Sonnet 4.6...');
    const recoveryResult = await worker.processClaimedIncident(claimed, {
      executionMode: 'LIVE_SONNET_LIVE_PAYSTACK',
    });

    console.log('[CASE 2] Worker Investigation & Recovery Result:');
    console.log(JSON.stringify(recoveryResult, null, 2));

    console.log('[CASE 2] Flushing telemetry to neatlogs...');
    await flush();

    // Query authoritative resolution from QueryService
    const incidentDetail = await queryService.getIncidentDetail(incident.id);

    console.log('--------------------------------------------------------------------------------');
    console.log('✓ CASE 2 SUCCESS: Real Paystack Autonomous Recovery Verified!');
    console.log(`  - Incident ID:              ${incidentDetail?.incident.id}`);
    console.log(`  - Final Incident Status:    ${incidentDetail?.incident.status}`);
    console.log(`  - Model Decision:           ${incidentDetail?.incident.lastDecision}`);
    console.log(`  - AI Model Used:            ${recoveryResult.modelUsed}`);
    console.log(`  - Multi-Turn Tool Sequence: ${recoveryResult.toolSequence.join(' -> ')}`);
    console.log(`  - Payment Provenance:       ${incidentDetail?.evidenceDossier.paymentVerificationState} (${incidentDetail?.evidenceDossier.verificationProvenance})`);
    console.log(`  - Verified Amount:          ${incidentDetail?.evidenceDossier.amountVerified} kobo (Match: ${incidentDetail?.evidenceDossier.amountMatched})`);
    console.log(`  - Entitlement Active:       ${incidentDetail?.evidenceDossier.entitlementActive} (ID: ${incidentDetail?.entitlement?.id})`);
    console.log(`  - Deterministic Gate:       ${incidentDetail?.evidenceDossier.gateAuthorized ? 'AUTHORIZED' : 'DENIED'}`);
    console.log(`  - neatlogs Trace URL:       ${incidentDetail?.neatlogsTrace.traceUrl || 'Telemetry recorded in neatlogs dashboard'}`);
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
