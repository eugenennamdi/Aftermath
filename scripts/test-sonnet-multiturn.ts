import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });

import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy) {
  setGlobalDispatcher(new EnvHttpProxyAgent());
}

import OpenAI from 'openai';
import { wrapOpenAI, init, flush } from 'neatlogs';

async function testMultiTurn() {
  console.log('[Test] Starting Sonnet 4.6 Multi-Turn Investigation Test...');
  const baseURL = process.env.LITELLM_BASE_URL || 'https://litellm.vision.aivar.app/v1';
  const apiKey = process.env.LITELLM_API_KEY!;
  const model = process.env.LITELLM_MODEL || 'claude-sonnet-4.6';

  await init({
    apiKey: process.env.NEATLOGS_API_KEY || 'dummy',
    workflowName: 'sonnet-multiturn-test',
  });

  const client = wrapOpenAI(new OpenAI({ baseURL, apiKey }));

  const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
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

  const systemInstruction = `You are Aftermath's Autonomous Incident Investigator.
A customer transaction was reported discrepant. Your mission is to autonomously investigate using the provided read-only tools:
1. Inspect the order to understand what was purchased.
2. Inspect payment evidence and independently verify the transaction with Paystack.
3. Inspect entitlement to see if access already exists.

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
      content: `Investigate discrepant incident:
- Incident ID: inc_test_123
- Order ID: ord_test_456
- Payment Reference: ref_test_789

Gather authoritative facts and submit your decision.`,
    },
  ];

  for (let turn = 1; turn <= 5; turn++) {
    console.log(`\n--- Turn ${turn} ---`);
    const response = await client.chat.completions.create({
      model,
      messages,
      tools,
      tool_choice: 'auto',
      max_tokens: 1024,
    });

    const choice = response.choices[0];
    const message = choice.message;
    console.log('Assistant content:', message.content);
    const functionCalls = (message.tool_calls || []).filter(
      (tc): tc is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall => tc.type === 'function'
    );
    console.log('Assistant tool_calls:', functionCalls.map(t => `${t.function.name}(${t.function.arguments})`));

    if (functionCalls.length === 0) {
      console.log('No more tool calls. Exiting loop.');
      break;
    }

    messages.push(message);

    let submittedDecision = false;
    for (const tc of functionCalls) {
      const name = tc.function.name;
      const args = JSON.parse(tc.function.arguments || '{}');
      console.log(`Executing tool: ${name} with args`, args);

      let result: any = {};
      if (name === 'inspect_order') {
        result = {
          order: {
            id: 'ord_test_456',
            customerId: 'cus_123',
            customerEmail: 'alex@example.com',
            expectedAmount: 500000,
            currency: 'NGN',
            status: 'PAID',
          },
        };
      } else if (name === 'verify_paystack_transaction') {
        result = {
          verification: {
            outcome: 'SUCCESS',
            amount: 500000,
            currency: 'NGN',
            customerEmail: 'alex@example.com',
            paidAt: '2026-10-10T14:00:00Z',
          },
        };
      } else if (name === 'inspect_entitlement') {
        result = {
          activeEntitlements: [],
          status: 'MISSING',
        };
      } else if (name === 'submit_investigation_decision') {
        result = { status: 'acknowledged', decision: args.decision };
        console.log(`>>> MODEL SUBMITTED DECISION: ${args.decision} - ${args.summary}`);
        submittedDecision = true;
      }

      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(result),
      });
    }

    if (submittedDecision) {
      console.log('Investigation concluded successfully!');
      break;
    }
  }

  await flush();
}

testMultiTurn().catch((err) => {
  console.error('[Test] Error:', err);
  process.exit(1);
});
