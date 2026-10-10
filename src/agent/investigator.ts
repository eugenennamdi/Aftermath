import OpenAI from 'openai';
import { GoogleGenAI, Type } from '@google/genai';
import { trace, log, wrapGoogleGenAI, wrapOpenAI } from 'neatlogs';
import {
  inspectOrder,
  inspectPaymentEvidence,
  verifyPaystackTransaction,
  inspectEntitlement,
  inspectPriorRecoveryAttempts,
} from './tools';
import { type PaystackVerificationAdapter } from '../lib/paystack';

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
  executionMode?: string;
  paystackAdapter?: PaystackVerificationAdapter;
}

/**
 * Tool Declarations for LiteLLM / OpenAI Chat Completions (Claude Sonnet 4.6)
 */
export const RECOVERY_TOOL_DECLARATIONS_OPENAI: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'inspect_order',
      description: 'Inspect local authoritative order record, expected amount (kobo), currency, and customer details for the current incident.',
      parameters: {
        type: 'object',
        properties: {
          orderId: { type: 'string', description: 'The order ID to inspect' },
        },
        required: ['orderId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'inspect_payment_evidence',
      description: 'Inspect recorded payment events (webhooks, prior transaction logs) for a payment reference.',
      parameters: {
        type: 'object',
        properties: {
          paymentReference: { type: 'string', description: 'Payment reference to inspect evidence for' },
        },
        required: ['paymentReference'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'verify_paystack_transaction',
      description: 'Independently query Paystack server API to verify transaction status, amount paid (in kobo), currency, and customer email.',
      parameters: {
        type: 'object',
        properties: {
          paymentReference: { type: 'string', description: 'Payment reference to verify with Paystack' },
        },
        required: ['paymentReference'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'inspect_entitlement',
      description: 'Inspect authoritative database entitlements table to check if customer already has active access for this order.',
      parameters: {
        type: 'object',
        properties: {
          orderId: { type: 'string', description: 'The order ID to inspect active entitlement for' },
        },
        required: ['orderId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'inspect_prior_recovery_attempts',
      description: 'Inspect incident recovery history, retry count, and audit logs for this incident.',
      parameters: {
        type: 'object',
        properties: {
          incidentId: { type: 'string', description: 'The incident ID to inspect recovery history for' },
        },
        required: ['incidentId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'submit_investigation_decision',
      description: 'Submit the final structured investigation decision after completing evidence gathering.',
      parameters: {
        type: 'object',
        properties: {
          decision: {
            type: 'string',
            description: 'Final decision: PROPOSE_RECOVERY | RECONCILE_EXISTING | RETRY_LATER | ESCALATE',
            enum: ['PROPOSE_RECOVERY', 'RECONCILE_EXISTING', 'RETRY_LATER', 'ESCALATE'],
          },
          summary: {
            type: 'string',
            description: 'Concise factual summary of findings and evidence rationale',
          },
        },
        required: ['decision', 'summary'],
      },
    },
  },
];

/**
 * Tool Declarations for Gemini Function Calling (preserved for manual rollback)
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
 * Autonomous Investigator Agent
 *
 * Primary Runtime Model: Claude Sonnet 4.6 via sponsored neatHack LiteLLM gateway
 * - Provider: `litellm_sonnet`
 * - Gateway: `https://litellm.vision.aivar.app/v1`
 * - Model: `claude-sonnet-4.6`
 * - SDK: Official OpenAI TypeScript SDK (`openai`)
 * - Observability: `neatlogs.wrapOpenAI()`
 *
 * Strict Cost Policy:
 * - Never charge personal accounts by default.
 * - If LiteLLM is unavailable or fails, durably defer via `RETRY_LATER`.
 * - Gemini path preserved for manual rollback only via `INVESTIGATOR_PROVIDER=gemini`.
 */
export async function investigateIncident(
  incidentId: string,
  orderId: string,
  paymentReference: string,
  options?: InvestigationOptions
): Promise<InvestigationResult> {
  // Strictly enforce sponsored LiteLLM Sonnet in production. Gemini rollback only allowed in non-production if explicitly configured.
  const isGeminiRollback =
    process.env.INVESTIGATOR_PROVIDER === 'gemini' && process.env.NODE_ENV !== 'production';

  return await trace(
    {
      name: 'autonomous_investigator_step',
      kind: 'AGENT',
      tags: [
        'investigator',
        isGeminiRollback ? 'gemini_agent' : 'claude_sonnet_agent',
        'recovery_loop',
      ],
    },
    async (agentSpan) => {
      agentSpan?.setAttribute('aftermath.incident_id', incidentId);
      agentSpan?.setAttribute('aftermath.order_id', orderId);
      agentSpan?.setAttribute('aftermath.payment_reference', paymentReference);

      if (isGeminiRollback) {
        return await executeGeminiInvestigation(incidentId, orderId, paymentReference, options, agentSpan);
      }

      return await executeLiteLLMSonnetInvestigation(incidentId, orderId, paymentReference, options, agentSpan);
    }
  );
}

function sanitizeProviderError(err: unknown): string {
  if (!err) return 'Unknown provider error';
  const raw = (err as Error).message || String(err);
  return raw
    .replace(/(?:Bearer\s+|key[=:\s]+|sk-)[a-zA-Z0-9_\-\.]{8,}/gi, '[REDACTED_SECRET]')
    .slice(0, 300);
}

/**
 * Primary Investigator: Claude Sonnet 4.6 via neatHack LiteLLM Gateway
 */
async function executeLiteLLMSonnetInvestigation(
  incidentId: string,
  orderId: string,
  paymentReference: string,
  options: InvestigationOptions | undefined,
  agentSpan: any
): Promise<InvestigationResult> {
  const modelName = process.env.LITELLM_MODEL || 'claude-sonnet-4.6';
  const baseURL = process.env.LITELLM_BASE_URL || 'https://litellm.vision.aivar.app/v1';
  const apiKey = process.env.LITELLM_API_KEY;
  const maxTurns = options?.maxTurns ?? 5;
  const executionMode = options?.executionMode || 'AUTONOMOUS_SWEEPER';
  const toolSequence: string[] = [];
  const gatheredEvidence: Record<string, unknown> = {};

  agentSpan?.setAttribute('aftermath.agent.model', modelName);
  agentSpan?.setAttribute('aftermath.agent.provider', 'litellm_sonnet');
  agentSpan?.setAttribute('aftermath.agent.gateway', baseURL);
  agentSpan?.setAttribute('aftermath.agent.execution_mode', executionMode);

  log('Starting autonomous investigation for incident {incidentId} using {modelName} via LiteLLM', {
    incidentId,
    orderId,
    modelName,
    baseURL,
    executionMode,
  });

  // Check if API key or mock transport is available
  if (!apiKey && !options?.mockTransport) {
    log('LiteLLM API key is not configured and no mock transport provided. Safely deferring without mutation.', {
      incidentId,
    });

    agentSpan?.setAttribute('aftermath.agent.decision', 'RETRY_LATER');
    agentSpan?.setAttribute('aftermath.agent.summary', 'LITELLM_API_KEY not configured; safe deferral');

    return {
      decision: 'RETRY_LATER',
      summary: 'LITELLM_API_KEY is not configured in environment. Investigation safely deferred.',
      modelUsed: modelName,
      provider: 'litellm_sonnet',
      turnsExecuted: 0,
      toolSequence: [],
      evidence: {},
    };
  }

  // Initialize OpenAI SDK wrapped in neatlogs with bounded retries and request timeout
  let openAIClient: OpenAI | null = null;
  if (apiKey && !options?.mockTransport) {
    try {
      const rawClient = new OpenAI({
        baseURL,
        apiKey,
        timeout: 30000,
        maxRetries: 2,
      });
      openAIClient = wrapOpenAI(rawClient);
    } catch (initErr) {
      console.error('[Investigator] Failed to initialize OpenAI client for LiteLLM:', initErr);
    }
  }

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

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemInstruction },
    {
      role: 'user',
      content: `Investigate discrepant incident:\n- Incident ID: ${incidentId}\n- Order ID: ${orderId}\n- Payment Reference: ${paymentReference}\n\nGather authoritative facts and submit your decision.`,
    },
  ];

  let turnsExecuted = 0;
  let finalDecision: AgentDecision | null = null;
  let finalSummary = '';
  let tokensUsed: { promptTokens: number; candidatesTokens: number; totalTokens: number } | undefined = undefined;
  const TOKEN_BUDGET_CEILING = parseInt(process.env.INVESTIGATION_TOKEN_BUDGET || '12000', 10);
  let accumulatedTokens = 0;
  let promptTokensAccum = 0;
  let candidatesTokensAccum = 0;

  for (let turn = 1; turn <= maxTurns; turn++) {
    turnsExecuted = turn;

    let functionCalls: Array<{ name: string; args: Record<string, unknown>; id?: string }> | undefined;
    let responseText: string | undefined;

    try {
      if (options?.mockTransport) {
        const mockRes = await options.mockTransport(turn, messages, RECOVERY_TOOL_DECLARATIONS_OPENAI);
        functionCalls = mockRes.functionCalls;
        responseText = mockRes.text;
      } else if (openAIClient) {
        const response = await openAIClient.chat.completions.create({
          model: modelName,
          messages,
          tools: RECOVERY_TOOL_DECLARATIONS_OPENAI,
          tool_choice: 'auto',
          max_tokens: 1024,
        });

        const choice = response.choices[0];
        const message = choice?.message;
        responseText = message?.content || undefined;

        if (response.usage) {
          const turnTokens = response.usage.total_tokens || 0;
          accumulatedTokens += turnTokens;
          promptTokensAccum += response.usage.prompt_tokens || 0;
          candidatesTokensAccum += response.usage.completion_tokens || 0;
          tokensUsed = {
            promptTokens: promptTokensAccum,
            candidatesTokens: candidatesTokensAccum,
            totalTokens: accumulatedTokens,
          };

          if (accumulatedTokens >= TOKEN_BUDGET_CEILING) {
            log('Investigation reached token budget ceiling ({accumulatedTokens} >= {TOKEN_BUDGET_CEILING}) for incident {incidentId}', {
              incidentId,
              accumulatedTokens,
              TOKEN_BUDGET_CEILING,
            });
            finalDecision = 'RETRY_LATER';
            finalSummary = `Investigation deferred: Token budget ceiling (${accumulatedTokens} tokens) reached.`;
            break;
          }
        }

        if (message?.tool_calls && message.tool_calls.length > 0) {
          functionCalls = message.tool_calls
            .filter((tc): tc is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall => tc.type === 'function')
            .map((tc) => {
              let parsedArgs: Record<string, unknown> = {};
              try {
                parsedArgs = JSON.parse(tc.function.arguments || '{}');
              } catch {
                parsedArgs = {};
              }
              return {
                name: tc.function.name,
                args: parsedArgs,
                id: tc.id,
              };
            });
          // Push assistant message with tool calls into conversation history
          messages.push(message);
        } else if (responseText) {
          messages.push({ role: 'assistant', content: responseText });
        }
      }
    } catch (modelErr) {
      const safeError = sanitizeProviderError(modelErr);
      log('LiteLLM Sonnet model generation error on turn {turn}: {error}', {
        turn,
        error: safeError,
      });
      finalDecision = 'RETRY_LATER';
      finalSummary = `Investigation deferred: LiteLLM Sonnet error during investigation: ${safeError}`;
      break;
    }

    // Check if model concluded without tool calls
    if (!functionCalls || functionCalls.length === 0) {
      if (responseText) {
        const parsed = parseDecisionFromText(responseText);
        if (parsed) {
          finalDecision = parsed.decision;
          finalSummary = parsed.summary;
          break;
        }
      }
      break;
    }

    // Execute requested tools dynamically
    for (const fc of functionCalls) {
      toolSequence.push(fc.name);

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

        if (fc.id) {
          messages.push({
            role: 'tool',
            tool_call_id: fc.id,
            content: JSON.stringify({ status: 'acknowledged', decision: finalDecision }),
          });
        }
        break;
      }

      // Server-Side Scoping Validation
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

        if (fc.id) {
          messages.push({
            role: 'tool',
            tool_call_id: fc.id,
            content: JSON.stringify({
              error: `SECURITY_REJECTED: ${isScoped.reason}`,
              scoped: false,
            }),
          });
        }
        continue;
      }

      // Execute requested tool with neatlogs tracing
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
          toolResult = await verifyPaystackTransaction(paymentReference, options?.paystackAdapter, {
            orderId,
            incidentId,
          });
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

      if (fc.id) {
        messages.push({
          role: 'tool',
          tool_call_id: fc.id,
          content: JSON.stringify({ result: toolResult }),
        });
      }
    }

    if (finalDecision) {
      break;
    }
  }

  if (!finalDecision) {
    finalDecision = 'ESCALATE';
    finalSummary = `Investigation exhausted ${turnsExecuted} turns without a definitive decision. Escalated for human review.`;
  }

  agentSpan?.setAttribute('aftermath.agent.decision', finalDecision);
  agentSpan?.setAttribute('aftermath.agent.summary', finalSummary);
  agentSpan?.setAttribute('aftermath.agent.tool_sequence', JSON.stringify(toolSequence));
  agentSpan?.setAttribute('aftermath.agent.turns_executed', turnsExecuted);
  if (tokensUsed) {
    agentSpan?.setAttribute('aftermath.agent.tokens_used', JSON.stringify(tokensUsed));
  }

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
    provider: 'litellm_sonnet',
    turnsExecuted,
    toolSequence,
    tokensUsed,
    evidence: gatheredEvidence,
  };
}

/**
 * Manual Rollback Engine: Gemini 3.8 Flash via @google/genai
 * Enabled only if process.env.INVESTIGATOR_PROVIDER === 'gemini'.
 */
async function executeGeminiInvestigation(
  incidentId: string,
  orderId: string,
  paymentReference: string,
  options: InvestigationOptions | undefined,
  agentSpan: any
): Promise<InvestigationResult> {
  const modelName = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
  const apiKey = process.env.GEMINI_API_KEY;
  const maxTurns = options?.maxTurns ?? 5;
  const toolSequence: string[] = [];
  const gatheredEvidence: Record<string, unknown> = {};

  agentSpan?.setAttribute('aftermath.agent.model', modelName);
  agentSpan?.setAttribute('aftermath.agent.provider', 'google_gemini');

  log('Starting rollback Gemini investigation for incident {incidentId} using {modelName}', {
    incidentId,
    orderId,
    modelName,
  });

  let genAIClient: GoogleGenAI | null = null;
  if (apiKey && !options?.mockTransport) {
    try {
      const rawClient = new GoogleGenAI({ apiKey });
      genAIClient = wrapGoogleGenAI(rawClient);
    } catch (initErr) {
      console.error('[Investigator] Failed to initialize GoogleGenAI client:', initErr);
    }
  }

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

  for (let turn = 1; turn <= maxTurns; turn++) {
    turnsExecuted = turn;

    let functionCalls: Array<{ name: string; args: Record<string, unknown>; id?: string }> | undefined;
    let responseText: string | undefined;
    let rawModelContent: Record<string, unknown> | undefined;

    if (options?.mockTransport) {
      const mockRes = await options.mockTransport(turn, contents, RECOVERY_TOOL_DECLARATIONS);
      functionCalls = mockRes.functionCalls;
      responseText = mockRes.text;
    } else if (genAIClient) {
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

    if (!functionCalls || functionCalls.length === 0) {
      if (responseText) {
        const parsed = parseDecisionFromText(responseText);
        if (parsed) {
          finalDecision = parsed.decision;
          finalSummary = parsed.summary;
          break;
        }
      }
      break;
    }

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

    const toolResponseParts: Array<Record<string, unknown>> = [];

    for (const fc of functionCalls) {
      toolSequence.push(fc.name);

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
          toolResult = await verifyPaystackTransaction(paymentReference, options?.paystackAdapter, {
            orderId,
            incidentId,
          });
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

    contents.push({
      role: 'user',
      parts: toolResponseParts,
    });

    if (finalDecision) {
      break;
    }
  }

  if (!finalDecision) {
    finalDecision = 'ESCALATE';
    finalSummary = `Investigation exhausted ${turnsExecuted} turns without a definitive decision. Escalated for human review.`;
  }

  agentSpan?.setAttribute('aftermath.agent.decision', finalDecision);
  agentSpan?.setAttribute('aftermath.agent.summary', finalSummary);
  agentSpan?.setAttribute('aftermath.agent.tool_sequence', JSON.stringify(toolSequence));
  agentSpan?.setAttribute('aftermath.agent.turns_executed', turnsExecuted);

  log('Investigation completed (Gemini Rollback): Decision={decision}, Turns={turns}, Sequence={sequence}', {
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
