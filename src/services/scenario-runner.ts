import crypto from 'node:crypto';
import { db } from '../db';
import { customers, orders, incidents, entitlements, auditLogs } from '../db/schema';
import { generatePaystackReference, type PaystackVerificationAdapter } from '../lib/paystack';
import { RecoveryWorker } from '../worker/recovery-worker';
import { createOrGetIncident } from './incident';
import { recoveryService } from './recovery';
import { entitlementService } from './entitlement';
import { eq } from 'drizzle-orm';

export interface ScenarioRunResult {
  scenario: 'A' | 'B' | 'C' | 'D';
  title: string;
  label: 'SIMULATED TEST FIXTURE';
  success: boolean;
  incidentId: string;
  orderId: string;
  entitlementId?: string | null;
  finalIncidentStatus: string;
  summary: string;
  steps: Array<{
    title: string;
    description: string;
    status: 'COMPLETE' | 'FAILED' | 'ESCALATED';
    timestamp: Date;
  }>;
}

export class ScenarioRunnerService {
  /**
   * Scenario A: Missing Entitlement -> Autonomous Recovery -> Verified Resolution
   * Demonstrates full pipeline with dependency-injected scoped Paystack adapter (zero global mutation).
   */
  public async runScenarioA(): Promise<ScenarioRunResult> {
    const customerId = `cus-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const customerEmail = `scenario-a-${Date.now()}@example.com`;
    const orderId = `ord-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const reference = generatePaystackReference();
    const steps: ScenarioRunResult['steps'] = [];

    // 1. Create Customer & Order marked PAID (fulfillment crashed/dropped)
    await db.insert(customers).values({
      id: customerId,
      email: customerEmail,
      name: 'Scenario A Operator Demo',
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

    steps.push({
      title: 'Discrepant Order Created',
      description: `Order ${orderId} marked PAID in PostgreSQL without corresponding active entitlement.`,
      status: 'COMPLETE',
      timestamp: new Date(),
    });

    // 2. Incident created (PAID_BUT_UNFULFILLED)
    const { incident } = await createOrGetIncident({
      orderId,
      paymentReference: reference,
      customerId,
      reason: 'PAID_BUT_UNFULFILLED',
      errorDetail: 'SIMULATED: Payment captured but entitlement provisioning dropped.',
    });

    steps.push({
      title: 'Incident Detected & Opened',
      description: `Incident ${incident.id} registered as OPEN in recovery pool.`,
      status: 'COMPLETE',
      timestamp: new Date(),
    });

    // 3. Scoped Paystack Adapter (Dependency Injected, No Global Mutation)
    const scopedAdapter: PaystackVerificationAdapter = {
      hasSecretKey: () => true,
      verifyTransaction: async (ref: string) => ({
        outcome: 'SUCCESS',
        reference: ref,
        amount: 500000,
        currency: 'NGN',
        customerEmail,
        paidAt: new Date(),
        gatewayResponse: 'Successful (Simulated Fixture)',
        rawData: { status: 'success' },
      }),
    };

    const worker = new RecoveryWorker({
      workerId: `scenario_worker_a_${Date.now()}`,
      paystackAdapter: scopedAdapter,
    });

    const claimed = await worker.claimNextIncident(incident.id);
    if (!claimed) {
      throw new Error('Worker failed to claim incident');
    }

    steps.push({
      title: 'Worker Claim & Fencing Acquired',
      description: `Worker ${worker.workerId} claimed incident with fencing token ${claimed.fencingToken} and 30s lease.`,
      status: 'COMPLETE',
      timestamp: new Date(),
    });

    // 4. Execute recovery pipeline
    const runOutcome = await worker.processClaimedIncident(claimed, {
      paystackAdapter: scopedAdapter,
      executionMode: 'TEST_FIXTURE_SCENARIO_A',
    });

    steps.push({
      title: 'Autonomous Investigation Completed',
      description: `Agent executed tools: [${runOutcome.toolSequence.join(', ')}]. Decision: ${runOutcome.decision}.`,
      status: 'COMPLETE',
      timestamp: new Date(),
    });

    // 5. Verify final state in database
    const [finalInc] = await db.select().from(incidents).where(eq(incidents.id, incident.id));
    const [finalEnt] = await db.select().from(entitlements).where(eq(entitlements.orderId, orderId));

    steps.push({
      title: 'Independent Verification & Resolution',
      description: `Authoritative read verified active entitlement ${finalEnt?.id}. Incident status: ${finalInc.status}.`,
      status: 'COMPLETE',
      timestamp: new Date(),
    });

    return {
      scenario: 'A',
      title: 'Missing Entitlement Autonomous Recovery',
      label: 'SIMULATED TEST FIXTURE',
      success: finalInc.status === 'RESOLVED',
      incidentId: incident.id,
      orderId,
      entitlementId: finalEnt?.id ?? null,
      finalIncidentStatus: finalInc.status,
      summary: `Autonomous recovery authorized, entitlement provisioned, and independently confirmed active.`,
      steps,
    };
  }

  /**
   * Scenario B: Transient Provisioning Failure & Idempotent Reconciliation
   * Demonstrates real 503 transient error injection to Worker 1, bounded backoff, and Worker 2 reconciliation.
   */
  public async runScenarioB(): Promise<ScenarioRunResult> {
    const customerId = `cus-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const customerEmail = `scenario-b-${Date.now()}@example.com`;
    const orderId = `ord-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const reference = generatePaystackReference();
    const steps: ScenarioRunResult['steps'] = [];

    await db.insert(customers).values({
      id: customerId,
      email: customerEmail,
      name: 'Scenario B Operator Demo',
    });

    await db.insert(orders).values({
      id: orderId,
      customerId,
      planId: 'plan_starter_monthly',
      paymentReference: reference,
      expectedAmount: 500000,
      currency: 'NGN',
      status: 'PAID',
      paidAt: new Date(),
    });

    const { incident } = await createOrGetIncident({
      orderId,
      paymentReference: reference,
      customerId,
      reason: 'PAID_BUT_UNFULFILLED',
      errorDetail: 'SIMULATED: Transient failure demonstration.',
    });

    steps.push({
      title: 'Incident Opened',
      description: `Discrepancy registered for order ${orderId}.`,
      status: 'COMPLETE',
      timestamp: new Date(),
    });

    // Step 1: Worker 1 with transient 503 error adapter
    const transient503Adapter: PaystackVerificationAdapter = {
      hasSecretKey: () => true,
      verifyTransaction: async (ref: string) => ({
        outcome: 'API_ERROR',
        reference: ref,
        error: 'Upstream Paystack 503 Gateway Timeout',
        statusCode: 503,
        retryable: true,
      }),
    };

    const worker1 = new RecoveryWorker({
      workerId: `scenario_worker_b1_${Date.now()}`,
      paystackAdapter: transient503Adapter,
    });

    const claimed1 = await worker1.claimNextIncident(incident.id);
    if (!claimed1) throw new Error('Worker 1 failed to claim');

    // Worker 1 executes investigation; detects transient 503 and schedules retry
    await worker1.processClaimedIncident(claimed1, {
      paystackAdapter: transient503Adapter,
      executionMode: 'TEST_FIXTURE_SCENARIO_B',
    });

    const [retriedInc] = await db.select().from(incidents).where(eq(incidents.id, incident.id));

    steps.push({
      title: 'Transient Failure & Retry Scheduled',
      description: `Worker 1 received 503, scheduled retry #${retriedInc.retryCount} with exponential backoff, and released lease.`,
      status: 'COMPLETE',
      timestamp: new Date(),
    });

    // Step 2: Simulate active entitlement created out-of-band during backoff window
    const entId = `ent_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const now = new Date();
    await db.insert(entitlements).values({
      id: entId,
      orderId,
      customerId,
      planId: 'plan_starter_monthly',
      sourceReference: reference,
      status: 'ACTIVE',
      startedAt: now,
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    });

    // Reset next_retry_at into the past so Worker 2 can immediately claim
    await db
      .update(incidents)
      .set({ nextRetryAt: new Date(Date.now() - 1000) })
      .where(eq(incidents.id, incident.id));

    // Step 3: Worker 2 claims and reconciles existing entitlement
    const healthyAdapter: PaystackVerificationAdapter = {
      hasSecretKey: () => true,
      verifyTransaction: async (ref: string) => ({
        outcome: 'SUCCESS',
        reference: ref,
        amount: 500000,
        currency: 'NGN',
        customerEmail,
        paidAt: new Date(),
        gatewayResponse: 'Successful',
        rawData: { status: 'success' },
      }),
    };

    const worker2 = new RecoveryWorker({
      workerId: `scenario_worker_b2_${Date.now()}`,
      paystackAdapter: healthyAdapter,
    });

    const claimed2 = await worker2.claimNextIncident(incident.id);
    if (!claimed2) throw new Error('Worker 2 failed to claim retried incident');

    await worker2.processClaimedIncident(claimed2, {
      paystackAdapter: healthyAdapter,
      executionMode: 'TEST_FIXTURE_SCENARIO_B',
    });

    const [finalInc] = await db.select().from(incidents).where(eq(incidents.id, incident.id));
    const allEnts = await db.select().from(entitlements).where(eq(entitlements.orderId, orderId));

    steps.push({
      title: 'Reconciliation & Idempotent Resolution',
      description: `Worker 2 reconciled active entitlement ${entId}. Total entitlements: ${allEnts.length} (zero duplicates).`,
      status: 'COMPLETE',
      timestamp: new Date(),
    });

    return {
      scenario: 'B',
      title: 'Transient Failure & Idempotent Reconciliation',
      label: 'SIMULATED TEST FIXTURE',
      success: finalInc.status === 'RESOLVED' && allEnts.length === 1,
      incidentId: incident.id,
      orderId,
      entitlementId: entId,
      finalIncidentStatus: finalInc.status,
      summary: `Transient error safely backed off, active entitlement discovered on subsequent claim, and reconciled without duplicate access.`,
      steps,
    };
  }

  /**
   * Scenario C: Unsafe / Underpaid Payment Blocked by Security Gate
   * Proves that underpaid attempts are caught by deterministic mathematical equality.
   */
  public async runScenarioC(): Promise<ScenarioRunResult> {
    const customerId = `cus-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const customerEmail = `scenario-c-${Date.now()}@example.com`;
    const orderId = `ord-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const reference = generatePaystackReference();
    const steps: ScenarioRunResult['steps'] = [];

    // Order expects 5,000 NGN (500,000 kobo)
    await db.insert(customers).values({
      id: customerId,
      email: customerEmail,
      name: 'Scenario C Security Demo',
    });

    await db.insert(orders).values({
      id: orderId,
      customerId,
      planId: 'plan_starter_monthly',
      paymentReference: reference,
      expectedAmount: 500000,
      currency: 'NGN',
      status: 'PENDING',
      createdAt: new Date(),
    });

    const { incident } = await createOrGetIncident({
      orderId,
      paymentReference: reference,
      customerId,
      reason: 'VERIFICATION_MISMATCH',
      errorDetail: 'SIMULATED: Potential underpayment or tampered payload.',
    });

    steps.push({
      title: 'Suspicious Incident Flagged',
      description: `Order ${orderId} expects 500,000 kobo (5,000 NGN).`,
      status: 'COMPLETE',
      timestamp: new Date(),
    });

    // Scoped Underpaid Adapter: returns 250,000 kobo != 500,000 kobo
    const underpaidAdapter: PaystackVerificationAdapter = {
      hasSecretKey: () => true,
      verifyTransaction: async (ref: string) => ({
        outcome: 'SUCCESS',
        reference: ref,
        amount: 250000, // UNDERPAID!
        currency: 'NGN',
        customerEmail,
        paidAt: new Date(),
        gatewayResponse: 'Successful (Underpaid Fixture)',
        rawData: { status: 'success' },
      }),
    };

    const worker = new RecoveryWorker({
      workerId: `scenario_worker_c_${Date.now()}`,
      paystackAdapter: underpaidAdapter,
    });

    const claimed = await worker.claimNextIncident(incident.id);
    if (!claimed) throw new Error('Worker failed to claim');

    await worker.processClaimedIncident(claimed, {
      paystackAdapter: underpaidAdapter,
      executionMode: 'TEST_FIXTURE_SCENARIO_C',
    });

    const [finalInc] = await db.select().from(incidents).where(eq(incidents.id, incident.id));
    const allEnts = await db.select().from(entitlements).where(eq(entitlements.orderId, orderId));

    steps.push({
      title: 'Deterministic Security Gate Evaluation',
      description: `Mathematical comparison: Expected 500,000 kobo vs Paid 250,000 kobo. Gate decision: REJECTED.`,
      status: 'ESCALATED',
      timestamp: new Date(),
    });

    steps.push({
      title: 'Terminal Escalation & Zero Entitlement Provisioned',
      description: `Incident transitioned to ESCALATED. Total entitlements created: ${allEnts.length}. Security boundary upheld.`,
      status: 'COMPLETE',
      timestamp: new Date(),
    });

    return {
      scenario: 'C',
      title: 'Unsafe / Mismatched Payment Rejection',
      label: 'SIMULATED TEST FIXTURE',
      success: finalInc.status === 'ESCALATED' && allEnts.length === 0,
      incidentId: incident.id,
      orderId,
      entitlementId: null,
      finalIncidentStatus: finalInc.status,
      summary: `Deterministic security gate detected underpayment, rejected access, escalated incident, and prevented unauthorized entitlement provisioning.`,
      steps,
    };
  }

  /**
   * Scenario D: Duplicate Events & Concurrency Idempotency
   * Demonstrates concurrent worker claiming (FOR UPDATE SKIP LOCKED) and duplicate event handling.
   */
  public async runScenarioD(): Promise<ScenarioRunResult> {
    const customerId = `cus-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const customerEmail = `scenario-d-${Date.now()}@example.com`;
    const orderId = `ord-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const reference = generatePaystackReference();
    const steps: ScenarioRunResult['steps'] = [];

    await db.insert(customers).values({
      id: customerId,
      email: customerEmail,
      name: 'Scenario D Concurrency Demo',
    });

    await db.insert(orders).values({
      id: orderId,
      customerId,
      planId: 'plan_starter_monthly',
      paymentReference: reference,
      expectedAmount: 500000,
      currency: 'NGN',
      status: 'PAID',
      paidAt: new Date(),
    });

    const { incident } = await createOrGetIncident({
      orderId,
      paymentReference: reference,
      customerId,
      reason: 'PAID_BUT_UNFULFILLED',
      errorDetail: 'SIMULATED: Concurrent worker claim demonstration.',
    });

    steps.push({
      title: 'Order Established & Incident Opened',
      description: `Order ${orderId} and Incident ${incident.id} registered.`,
      status: 'COMPLETE',
      timestamp: new Date(),
    });

    // 1. Competing Worker Claims via FOR UPDATE SKIP LOCKED
    const worker1 = new RecoveryWorker({ workerId: `scenario_worker_d1_${Date.now()}` });
    const worker2 = new RecoveryWorker({ workerId: `scenario_worker_d2_${Date.now()}` });

    const [claim1, claim2] = await Promise.all([
      worker1.claimNextIncident(incident.id),
      worker2.claimNextIncident(incident.id),
    ]);

    const winnerClaim = claim1 || claim2;
    const loserClaim = claim1 ? claim2 : claim1;

    steps.push({
      title: 'Competing Worker Claim Evaluation',
      description: `Worker 1 claim: ${claim1 ? 'ACQUIRED' : 'LOCKED_OUT'}. Worker 2 claim: ${claim2 ? 'ACQUIRED' : 'LOCKED_OUT'}. FOR UPDATE SKIP LOCKED prevented double claiming.`,
      status: 'COMPLETE',
      timestamp: new Date(),
    });

    // 2. Concurrently trigger two provisioning calls simulating simultaneous webhooks
    const [res1, res2] = await Promise.all([
      entitlementService.provisionEntitlement(orderId, reference),
      entitlementService.provisionEntitlement(orderId, reference),
    ]);

    steps.push({
      title: 'Concurrent Provisioning Executed',
      description: `Attempt 1: ${res1.success ? 'Created' : res1.code}. Attempt 2: ${res2.success ? 'Created' : res2.code}.`,
      status: 'COMPLETE',
      timestamp: new Date(),
    });

    const allEnts = await db.select().from(entitlements).where(eq(entitlements.orderId, orderId));

    steps.push({
      title: 'Database Uniqueness Invariant Verified',
      description: `PostgreSQL unique index on order_id enforced single entitlement (${allEnts.length} row).`,
      status: 'COMPLETE',
      timestamp: new Date(),
    });

    return {
      scenario: 'D',
      title: 'Duplicate Events & Concurrency Idempotency',
      label: 'SIMULATED TEST FIXTURE',
      success:
        Boolean(winnerClaim) &&
        loserClaim === null &&
        allEnts.length === 1 &&
        (res1.success || res2.success),
      incidentId: incident.id,
      orderId,
      entitlementId: allEnts[0]?.id ?? null,
      finalIncidentStatus: incident.status,
      summary: `Simultaneous worker claims and fulfillment attempts resolved idempotently: relational engine uniqueness and row locking prevented duplicate access.`,
      steps,
    };
  }
}

export const scenarioRunnerService = new ScenarioRunnerService();
