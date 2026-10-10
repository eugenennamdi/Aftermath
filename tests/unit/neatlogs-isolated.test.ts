import { describe, it, expect } from 'vitest';
import { sanitizeTelemetryPayload, runIsolatedTestWorkflow } from '@/lib/neatlogs';

describe('neatlogs Integration & Privacy Sanitization', () => {
  it('correctly redacts sensitive keys, secrets, and customer emails', () => {
    const rawPayload = {
      api_key: 'sk_live_1234567890abcdef',
      client_secret: 'super_secret_token',
      auth_token: 'bearer_xyz',
      card_number: '4242424242424242',
      customer_email: 'alex@example.com',
      incident_id: 'inc_999',
      amount: 15000,
    };

    const sanitized = sanitizeTelemetryPayload(rawPayload);

    expect(sanitized.api_key).toBe('[REDACTED_SECRET]');
    expect(sanitized.client_secret).toBe('[REDACTED_SECRET]');
    expect(sanitized.auth_token).toBe('[REDACTED_SECRET]');
    expect(sanitized.card_number).toBe('[REDACTED_PAYMENT_DATA]');
    expect(sanitized.customer_email).toBe('al***@example.com');
    // Non-sensitive fields preserved
    expect(sanitized.incident_id).toBe('inc_999');
    expect(sanitized.amount).toBe(15000);
  });

  it('runs isolated verification workflow and returns completed test telemetry', async () => {
    const result = await runIsolatedTestWorkflow('test_inc_phase0');

    expect(result).toBeDefined();
    expect(result.incidentId).toBe('test_inc_phase0');
    expect(result.agentDecision).toBeDefined();
    expect(result.agentDecision.proposedAction).toBe('GRANT_ENTITLEMENT');
    expect(result.guardrailOutcome.authorized).toBe(true);
    expect(result.status).toBe('VERIFIED_TEST_WORKFLOW_COMPLETE');
  });
});
