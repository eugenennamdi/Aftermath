import { GoogleGenAI, Type } from '@google/genai';
import { trace, log, wrapGoogleGenAI } from 'neatlogs';
import {
  inspectOrder,
  inspectPaymentEvidence,
  verifyPaystackTransaction,
  inspectEntitlement,
  inspectPriorRecoveryAttempts,
} from './tools';

export type AgentDecision = 'PROPOSE_RECOVERY' | 'RECONCILE_EXISTING' | 'RETRY_LATER' | 'ESCALATE';

export interface InvestigationResult {
  decision: AgentDecision;
  summary: string;
  modelUsed: string;
  provider: string;
  turnsExecuted: number;
  toolSequence: string[];
  tokensUsed?: {
    promptTokens?: number;
    candidatesTokens?: number;
    totalTokens?: number;
  };
  evidence: {
    order?: unknown;
    paymentEvents?: unknown;
    paystack?: unknown;
    entitlement?: unknown;
    priorAttempts?: unknown;
  };
}

export interface MockTurnResponse {
  functionCalls?: Array<{
    name: string;
    args: Record<string, unknown>;
  }>;
  text?: string;
}

export type LLMMockTransport = (
  turn: number,
  contents: unknown[],
  tools: unknown[]
) => Promise<MockTurnResponse>;

export interface InvestigationOptions {
  mockTransport?: LLMMockTransport;
  maxTurns?: number;
  timeoutMs?: number;
}

/**
 * Tool Declarations for Gemini Function Calling
 */
export const RECOVERY_TOOL_DECLARATIONS = [
  {
    name: 'inspect_order',
    description: 'Inspect local authoritative order record, expected amount (kobo), currency, and customer details for the current incident.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        orderId: { type: Type.STRING, description: 'The order ID to inspect' },
      },
      required: ['orderId'],
    },
  },
  {
    name: 'inspect_payment_evidence',
    description: 'Inspect recorded payment events (webhooks, prior transaction logs) for a payment reference.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        paymentReference: { type: Type.STRING, description: 'Payment reference to inspect evidence for' },
      },
      required: ['paymentReference'],
    },
  },
  {
    name: 'verify_paystack_transaction',
    description: 'Independently query Paystack server API to verify transaction status, amount paid (in kobo), currency, and customer email.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        paymentReference: { type: Type.STRING, description: 'Payment reference to verify with Paystack' },
      },
      required: ['paymentReference'],
    },
  },
  {
    name: 'inspect_entitlement',
    description: 'Inspect authoritative database entitlements table to check if customer already has active access for this order.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        orderId: { type: Type.STRING, description: 'The order ID to inspect active entitlement for' },
      },
      required: ['orderId'],
    },
  },
  {
    name: 'inspect_prior_recovery_attempts',
    description: 'Inspect incident recovery history, retry count, and audit logs for this incident.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        incidentId: { type: Type.STRING, description: 'The incident ID to inspect recovery history for' },
      },
      required: ['incidentId'],
    },
  },
  {
    name: 'submit_investigation_decision',
    description: 'Submit the final structured investigation decision after completing evidence gathering.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        decision: {
          type: Type.STRING,
          description: 'Final decision: PROPOSE_RECOVERY | RECONCILE_EXISTING | RETRY_LATER | ESCALATE',
        },
        summary: {
          type: Type.STRING,
          description: 'Concise factual summary of findings and evidence rationale',
        },
      },
      required: ['decision', 'summary'],
    },
  },
];

/**
 * Autonomous Investigator Agent powered by Gemini 3.8 Flash
 * 
 * - Provider: Google Gemini API (`@google/genai`)
 * - Model: `gemini-3.8-flash`
 * - Dynamic Function Calling: The model decides which tools to invoke based on observations
 * - Server-side Scoping: Enforces argument validation against claimed incident context
 * - Observability: Wrapped in neatlogs with AGENT and TOOL spans
 */
export async function investigateIncident(
  incidentId: string,
  orderId: string,
  paymentReference: string,
  options?: InvestigationOptions
): Promise<InvestigationResult> {
  return await trace(
    {
      name: 'autonomous_investigator_step',
      kind: 'AGENT',
      tags: ['investigator', 'gemini_agent', 'recovery_loop'],
    },
    async (agentSpan) => {
      agentSpan?.setAttribute('aftermath.incident_id', incidentId);
      agentSpan?.setAttribute('aftermath.order_id', orderId);
      agentSpan?.setAttribute('aftermath.payment_reference', paymentReference);

      const modelName = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
      const apiKey = process.env.GEMINI_API_KEY;
      const maxTurns = options?.maxTurns ?? 5;
      const toolSequence: string[] = [];
      const gatheredEvidence: Record<string, unknown> = {};

      agentSpan?.setAttribute('aftermath.agent.model', modelName);
      agentSpan?.setAttribute('aftermath.agent.provider', 'google_gemini');

      log('Starting autonomous investigation for incident {incidentId} using {modelName}', {
        incidentId,
        orderId,
        modelName,
      });

      // Initialize Gemini SDK with neatlogs wrapping if API key is configured
      let genAIClient: GoogleGenAI | null = null;
      if (apiKey && !options?.mockTransport) {
        try {
          const rawClient = new GoogleGenAI({ apiKey });
          genAIClient = wrapGoogleGenAI(rawClient);
        } catch (initErr) {
          console.error('[Investigator] Failed to initialize GoogleGenAI client:', initErr);
        }
      }

      // Check if neither real API key nor mock transport is available
      if (!genAIClient && !options?.mockTransport) {
        log('Gemini API key is not configured and no mock transport provided. Safely deferring without mutation.', {
          incidentId,
        });

        agentSpan?.setAttribute('aftermath.agent.decision', 'RETRY_LATER');
        agentSpan?.setAttribute('aftermath.agent.summary', 'GEMINI_API_KEY not configured; safe deferral');

        return {
          decision: 'RETRY_LATER',
          summary: 'GEMINI_API_KEY is not configured in environment. Investigation safely deferred.',
          modelUsed: modelName,
          provider: 'google_gemini',
          turnsExecuted: 0,
          toolSequence: [],
          evidence: {},
        };
      }

      // Build initial prompt & system instruction
      const systemInstruction = `You are Aftermath's Autonomous Incident Investigator.
A customer transaction was reported discrepant. Your mission is to autonomously investigate using the provided read-only tools:
1. Inspect the order to understand what was purchased.
2. Inspect payment evidence and independently verify the transaction with Paystack.
3. Inspect entitlement to see if access already exists.
4. Inspect prior attempts if needed.

Rules:
- You must decide which tools to call dynamically based on what you find.
- Once you have sufficient facts, call 'submit_investigation_decision' with your structured decision:
  * PROPOSE_RECOVERY: Verified payment strictly matches trusted order and entitlement is missing.
  * RECONCILE_EXISTING: Entitlement already active in database for this order.
  * RETRY_LATER: Transient provider network failure with retries remaining.
  * ESCALATE: Security mismatch (amount, currency, email) or definitive transaction failure.
- Never invent evidence. Be concise, factual, and accurate.`;

      const contents: Array<{
        role: 'user' | 'model';
        parts: Array<Record<string, unknown>>;
      }> = [
        {
          role: 'user',
          parts: [
            {
              text: `Investigate discrepant incident:\n- Incident ID: ${incidentId}\n- Order ID: ${orderId}\n- Payment Reference: ${paymentReference}\n\nGather authoritative facts and submit your decision.`,
            },
          ],
        },
      ];

      let turnsExecuted = 0;
      let finalDecision: AgentDecision | null = null;
      let finalSummary = '';
      let tokensUsed: InvestigationResult['tokensUsed'] = undefined;

      // Multi-turn Autonomous Model-Tool Interaction Loop
      for (let turn = 1; turn <= maxTurns; turn++) {
        turnsExecuted = turn;

        let functionCalls: Array<{ name: string; args: Record<string, unknown>; id?: string }> | undefined;
        let responseText: string | undefined;
        let rawModelContent: Record<string, unknown> | undefined;

        if (options?.mockTransport) {
          // Use injected mock transport for verifiable multi-turn testing
          const mockRes = await options.mockTransport(turn, contents, RECOVERY_TOOL_DECLARATIONS);
          functionCalls = mockRes.functionCalls;
          responseText = mockRes.text;
        } else if (genAIClient) {
          // Execute real Gemini API call
          try {
            const response = await genAIClient.models.generateContent({
              model: modelName,
              contents: contents as any,
              config: {
                systemInstruction: { parts: [{ text: systemInstruction }] },
                tools: [{ functionDeclarations: RECOVERY_TOOL_DECLARATIONS as any }],
                thinkingConfig: {
                  thinkingBudget: 1024,
                },
              },
            });

            rawModelContent = response.candidates?.[0]?.content as Record<string, unknown> | undefined;
            functionCalls = response.functionCalls
              ?.filter((fc) => typeof fc.name === 'string' && fc.name.length > 0)
              .map((fc) => ({
                name: fc.name as string,
                args: (fc.args || {}) as Record<string, unknown>,
                id: (fc as any).id as string | undefined,
              }));
            responseText = response.text;

            if (response.usageMetadata) {
              tokensUsed = {
                promptTokens: response.usageMetadata.promptTokenCount,
                candidatesTokens: response.usageMetadata.candidatesTokenCount,
                totalTokens: response.usageMetadata.totalTokenCount,
              };
            }
          } catch (modelErr) {
            log('Gemini model generation error on turn {turn}: {error}', {
              turn,
              error: (modelErr as Error).message,
            });
            finalDecision = 'RETRY_LATER';
            finalSummary = `Gemini model error during investigation: ${(modelErr as Error).message}`;
            break;
          }
        }

        // If no function calls returned by model, check if it supplied decision in text or complete
        if (!functionCalls || functionCalls.length === 0) {
          if (responseText) {
            // Attempt to parse structured decision from text if model emitted JSON
            const parsed = parseDecisionFromText(responseText);
            if (parsed) {
              finalDecision = parsed.decision;
              finalSummary = parsed.summary;
              break;
            }
          }

          // Model ended conversation without submitting explicit decision; break loop
          break;
        }

        // Record model turn in conversation history.
        // For Gemini, preserve full raw candidate content to retain cryptographically valid thought signatures.
        if (rawModelContent) {
          contents.push(rawModelContent as any);
        } else {
          contents.push({
            role: 'model',
            parts: functionCalls.map((fc) => ({
              functionCall: { name: fc.name, args: fc.args, ...(fc.id ? { id: fc.id } : {}) },
            })),
          });
        }

        // Execute each tool call dynamically requested by the model
        const toolResponseParts: Array<Record<string, unknown>> = [];

        for (const fc of functionCalls) {
          toolSequence.push(fc.name);

          // Check if model submitted final decision
          if (fc.name === 'submit_investigation_decision') {
            const dec = (fc.args.decision as string)?.toUpperCase();
            if (
              dec === 'PROPOSE_RECOVERY' ||
              dec === 'RECONCILE_EXISTING' ||
              dec === 'RETRY_LATER' ||
              dec === 'ESCALATE'
            ) {
              finalDecision = dec as AgentDecision;
              finalSummary = (fc.args.summary as string) || `Model submitted ${dec}`;
            } else {
              finalDecision = 'ESCALATE';
              finalSummary = `Model submitted unrecognized decision: ${fc.args.decision}`;
            }

            toolResponseParts.push({
              functionResponse: {
                name: fc.name,
                response: { status: 'acknowledged', decision: finalDecision },
                ...(fc.id ? { id: fc.id } : {}),
              },
            });
            break;
          }

          // Server-Side Scoping Validation:
          // Strictly prevent model from inspecting resources outside claimed incident scope
          const isScoped = validateToolScoping(fc.name, fc.args, {
            incidentId,
            orderId,
            paymentReference,
          });

          if (!isScoped.valid) {
            log('Security warning: tool call {toolName} failed server-side scoping: {reason}', {
              toolName: fc.name,
              reason: isScoped.reason,
            });

            toolResponseParts.push({
              functionResponse: {
                name: fc.name,
                response: {
                  error: `SECURITY_REJECTED: ${isScoped.reason}`,
                  scoped: false,
                },
                ...(fc.id ? { id: fc.id } : {}),
              },
            });
            continue;
          }

          // Execute requested tool with neatlogs tracing and sanitization
          let toolResult: unknown;
          switch (fc.name) {
            case 'inspect_order':
              toolResult = await inspectOrder(orderId);
              gatheredEvidence.order = toolResult;
              break;

            case 'inspect_payment_evidence':
              toolResult = await inspectPaymentEvidence(paymentReference);
              gatheredEvidence.paymentEvents = toolResult;
              break;

            case 'verify_paystack_transaction':
              toolResult = await verifyPaystackTransaction(paymentReference);
              gatheredEvidence.paystack = toolResult;
              break;

            case 'inspect_entitlement':
              toolResult = await inspectEntitlement(orderId);
              gatheredEvidence.entitlement = toolResult;
              break;

            case 'inspect_prior_recovery_attempts':
              toolResult = await inspectPriorRecoveryAttempts(incidentId);
              gatheredEvidence.priorAttempts = toolResult;
              break;

            default:
              toolResult = { error: `Unrecognized tool: ${fc.name}` };
          }

          toolResponseParts.push({
            functionResponse: {
              name: fc.name,
              response: { result: toolResult },
              ...(fc.id ? { id: fc.id } : {}),
            },
          });
        }

        // Add tool responses to conversation contents for subsequent model turns
        contents.push({
          role: 'user',
          parts: toolResponseParts,
        });

        // If model already submitted its final decision, exit turn loop
        if (finalDecision) {
          break;
        }
      }

      // If model exhausted turns without submitting decision, default to safe escalation
      if (!finalDecision) {
        finalDecision = 'ESCALATE';
        finalSummary = `Investigation exhausted ${turnsExecuted} turns without a definitive decision. Escalated for human review.`;
      }

      agentSpan?.setAttribute('aftermath.agent.decision', finalDecision);
      agentSpan?.setAttribute('aftermath.agent.summary', finalSummary);
      agentSpan?.setAttribute('aftermath.agent.tool_sequence', JSON.stringify(toolSequence));
      agentSpan?.setAttribute('aftermath.agent.turns_executed', turnsExecuted);

      log('Investigation completed: Decision={decision}, Turns={turns}, Sequence={sequence}', {
        decision: finalDecision,
        turns: turnsExecuted,
        sequence: toolSequence.join(' -> '),
        summary: finalSummary,
      });

      return {
        decision: finalDecision,
        summary: finalSummary,
        modelUsed: modelName,
        provider: 'google_gemini',
        turnsExecuted,
        toolSequence,
        tokensUsed,
        evidence: gatheredEvidence,
      };
    }
  );
}

/**
 * Server-Side Scoping Validator
 * Ensures tool arguments are strictly bounded to the claimed incident.
 */
export function validateToolScoping(
  toolName: string,
  args: Record<string, unknown>,
  context: { incidentId: string; orderId: string; paymentReference: string }
): { valid: boolean; reason?: string } {
  if (args.orderId && args.orderId !== context.orderId) {
    return {
      valid: false,
      reason: `orderId "${args.orderId}" does not match claimed incident orderId "${context.orderId}"`,
    };
  }

  if (args.paymentReference && args.paymentReference !== context.paymentReference) {
    return {
      valid: false,
      reason: `paymentReference "${args.paymentReference}" does not match claimed incident reference "${context.paymentReference}"`,
    };
  }

  if (args.incidentId && args.incidentId !== context.incidentId) {
    return {
      valid: false,
      reason: `incidentId "${args.incidentId}" does not match claimed incident ID "${context.incidentId}"`,
    };
  }

  return { valid: true };
}

/**
 * Helper to parse structured decision from freeform model response
 */
function parseDecisionFromText(text: string): { decision: AgentDecision; summary: string } | null {
  try {
    const jsonMatch = text.match(/\{[\s\S]*"decision"[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const dec = parsed.decision?.toUpperCase();
      if (['PROPOSE_RECOVERY', 'RECONCILE_EXISTING', 'RETRY_LATER', 'ESCALATE'].includes(dec)) {
        return {
          decision: dec as AgentDecision,
          summary: parsed.summary || text.slice(0, 200),
        };
      }
    }
  } catch {
    // Ignore JSON parse error
  }
  return null;
}
