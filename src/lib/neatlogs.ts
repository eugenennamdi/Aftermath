import { config } from 'dotenv';
// Load environment variables (.env.local has precedence over .env)
config({ path: '.env.local' });
config({ path: '.env' });

import { init, trace, span, flush, log } from 'neatlogs';

let isInitialized = false;

/**
 * Client-side PII and Secret Redaction Utility
 * Prevents raw credentials, card details, or sensitive PII from leaking into public traces.
 */
export function sanitizeTelemetryPayload<T extends Record<string, unknown>>(data: T): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey.includes('key') || lowerKey.includes('secret') || lowerKey.includes('token') || lowerKey.includes('auth')) {
      sanitized[key] = '[REDACTED_SECRET]';
    } else if (lowerKey.includes('card') || lowerKey.includes('cvv') || lowerKey.includes('pan')) {
      sanitized[key] = '[REDACTED_PAYMENT_DATA]';
    } else if (lowerKey.includes('email') && typeof value === 'string') {
      const parts = value.split('@');
      sanitized[key] = parts.length === 2 ? `${parts[0].slice(0, 2)}***@${parts[1]}` : '[REDACTED_EMAIL]';
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      sanitized[key] = sanitizeTelemetryPayload(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

/**
 * Initialize neatlogs SDK with environment configuration
 */
export async function initNeatlogs() {
  if (isInitialized) return;
  const apiKey = process.env.NEATLOGS_API_KEY;

  if (!apiKey) {
    console.warn('[neatlogs] NEATLOGS_API_KEY is not set. Telemetry will operate in offline/mock mode.');
    return;
  }

  try {
    await init({
      apiKey,
      ...(process.env.NEATLOGS_ENDPOINT ? { endpoint: process.env.NEATLOGS_ENDPOINT } : {}),
      workflowName: process.env.NEATLOGS_WORKFLOW_NAME || 'aftermath-recovery',
    });
    isInitialized = true;
    console.log('[neatlogs] Successfully initialized SDK with workflow:', process.env.NEATLOGS_WORKFLOW_NAME || 'aftermath-recovery');
  } catch (err) {
    console.error('[neatlogs] Failed to initialize SDK:', err);
  }
}

/**
 * Minimal Isolated Test Workflow (Phase 0 Verification)
 * Demonstrates:
 * 1. Root workflow span
 * 2. Nested agent reasoning span
 * 3. Nested tool execution span with sanitized I/O
 * 4. Nested guardrail validation span
 * 5. Correlated incident ID
 * 6. Explicit flush
 */
export async function runIsolatedTestWorkflow(incidentId: string = 'test_inc_001') {
  await initNeatlogs();

  return await trace(
    {
      name: 'aftermath_recovery_workflow',
      kind: 'WORKFLOW',
      tags: ['phase_0_verification', 'test'],
    },
    async (workflowSpan) => {
      const spanCtx = workflowSpan?.spanContext();
      const traceId = spanCtx?.traceId;
      const rootSpanId = spanCtx?.spanId;
      workflowSpan?.setAttribute('aftermath.incident_id', incidentId);
      workflowSpan?.setAttribute('aftermath.order_id', 'ord_test_999');

      log('Starting isolated verification workflow for incident {incidentId}', { incidentId });

      // Step 1: Agent Reasoning Span
      const agentDecision = await trace(
        {
          name: 'investigation_agent_step',
          kind: 'AGENT',
        },
        async (agentSpan) => {
          agentSpan?.setAttribute('aftermath.agent.role', 'investigator');

          // Step 2: Nested Tool Span with sanitized input/output
          const rawToolInput = {
            reference: 'ref_paystack_test_12345',
            customer_email: 'customer@example.com',
            api_secret: 'sk_test_fake_secret_key',
          };
          const sanitizedInput = sanitizeTelemetryPayload(rawToolInput);

          const toolResult = await trace(
            {
              name: 'verify_paystack_transaction',
              kind: 'TOOL',
            },
            async (toolSpan) => {
              toolSpan?.setAttribute('tool.input', JSON.stringify(sanitizedInput));

              // Simulated verified response
              const rawToolOutput = {
                status: 'success',
                amount_in_kobo: 5000000,
                currency: 'NGN',
                customer_email: 'customer@example.com',
              };
              const sanitizedOutput = sanitizeTelemetryPayload(rawToolOutput);
              toolSpan?.setAttribute('tool.output', JSON.stringify(sanitizedOutput));
              return sanitizedOutput;
            }
          );

          return { proposedAction: 'GRANT_ENTITLEMENT', evidence: toolResult };
        }
      );

      // Step 3: Guardrail Span
      const guardrailOutcome = await trace(
        {
          name: 'deterministic_authorization_guardrail',
          kind: 'GUARDRAIL',
        },
        async (guardrailSpan) => {
          guardrailSpan?.setAttribute('guardrail.decision', 'AUTHORIZED');
          guardrailSpan?.setAttribute('guardrail.reason', 'Amounts, currency, and customer match trusted order');
          return { authorized: true };
        }
      );

      // Flush telemetry to ensure all spans leave the runtime buffer
      try {
        await flush();
      } catch (flushErr) {
        console.warn('[neatlogs] Flush warning (expected if unauthenticated in offline mode):', flushErr);
      }

      return {
        incidentId,
        traceId,
        rootSpanId,
        agentDecision,
        guardrailOutcome,
        status: 'VERIFIED_TEST_WORKFLOW_COMPLETE',
      };
    }
  );
}
