import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });

import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy) {
  setGlobalDispatcher(new EnvHttpProxyAgent());
}

import OpenAI from 'openai';
import { wrapOpenAI, init, flush } from 'neatlogs';

async function testSonnetProbe() {
  console.log('[Probe] Testing sponsored Claude Sonnet 4.6 via LiteLLM...');
  const baseURL = process.env.LITELLM_BASE_URL || 'https://litellm.vision.aivar.app/v1';
  const apiKey = process.env.LITELLM_API_KEY;
  const model = process.env.LITELLM_MODEL || 'claude-sonnet-4.6';

  if (!apiKey) {
    throw new Error('LITELLM_API_KEY is not set in environment or .env.local');
  }

  console.log(`[Probe] Gateway: ${baseURL}`);
  console.log(`[Probe] Model Alias: ${model}`);

  await init({
    apiKey: process.env.NEATLOGS_API_KEY || 'dummy',
    workflowName: 'sonnet-migration-probe',
  });

  const rawClient = new OpenAI({
    baseURL,
    apiKey,
  });

  const client = wrapOpenAI(rawClient);

  // Define a simple tool declaration in OpenAI function calling schema
  const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
    {
      type: 'function',
      function: {
        name: 'inspect_order',
        description: 'Inspect order details in PostgreSQL',
        parameters: {
          type: 'object',
          properties: {
            orderId: { type: 'string', description: 'Order ID to inspect' },
          },
          required: ['orderId'],
        },
      },
    },
  ];

  console.log('[Probe] Sending ChatCompletion request with function declaration...');
  const response = await client.chat.completions.create({
    model,
    messages: [
      {
        role: 'user',
        content: 'Please inspect order "ord_123456" using the available tools.',
      },
    ],
    tools,
    tool_choice: 'auto',
  });

  console.log('[Probe] Response received successfully!');
  const choice = response.choices[0];
  console.log('[Probe] Finish Reason:', choice?.finish_reason);
  console.log('[Probe] Tool Calls:', JSON.stringify(choice?.message?.tool_calls, null, 2));
  console.log('[Probe] Text Content:', choice?.message?.content);
  console.log('[Probe] Usage:', JSON.stringify(response.usage, null, 2));

  await flush();
  console.log('[Probe] Telemetry flushed.');
}

testSonnetProbe().catch((err) => {
  console.error('[Probe] Error:', err.message, err.cause || '');
  process.exit(1);
});
