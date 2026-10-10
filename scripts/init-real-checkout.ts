import crypto from 'node:crypto';
import { db } from '../src/db';
import { customers, orders, subscriptionPlans } from '../src/db/schema';
import { paystackClient, generatePaystackReference } from '../src/lib/paystack';
import { eq } from 'drizzle-orm';

async function main() {
  const args = process.argv.slice(2);
  const caseArg = args.find((a, i) => a === '--case' ? args[i + 1] : a.startsWith('--case=') ? a.split('=')[1] : null) || '1';
  const caseNum = parseInt(caseArg, 10);

  console.log('================================================================================');
  console.log(`AFTERMATH REAL PAYSTACK TEST CHECKOUT INITIALIZATION (CASE ${caseNum})`);
  console.log('================================================================================');

  if (!paystackClient.hasSecretKey()) {
    console.error('ERROR: PAYSTACK_SECRET_KEY is not configured in .env.local.');
    process.exit(1);
  }

  const [plan] = await db
    .select()
    .from(subscriptionPlans)
    .where(eq(subscriptionPlans.id, 'plan_starter_monthly'))
    .limit(1);

  if (!plan) {
    console.error('ERROR: Plan "plan_starter_monthly" not found in database catalog.');
    process.exit(1);
  }

  const timestamp = Date.now();
  const customerId = `cus_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const customerEmail = `operator-test-${caseNum}-${timestamp}@example.com`;
  const customerName = `Operator Test User ${caseNum}`;

  await db.insert(customers).values({
    id: customerId,
    email: customerEmail,
    name: customerName,
  });

  const paymentReference = generatePaystackReference();
  const orderId = `ord_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

  await db.insert(orders).values({
    id: orderId,
    customerId,
    planId: plan.id,
    paymentReference,
    expectedAmount: plan.amount,
    currency: plan.currency,
    status: 'PENDING',
  });

  console.log(`[Order Created] Order ID:         ${orderId}`);
  console.log(`[Order Created] Customer Email:   ${customerEmail}`);
  console.log(`[Order Created] Plan:             ${plan.name} (${plan.id})`);
  console.log(`[Order Created] Expected Amount:  ${plan.amount / 100} ${plan.currency} (${plan.amount} kobo)`);
  console.log(`[Order Created] Payment Ref:      ${paymentReference}`);
  console.log('--------------------------------------------------------------------------------');
  console.log('[Paystack] Calling Paystack initialize API in test mode...');

  const callbackUrl = 'http://localhost:3000/checkout/complete';
  const initRes = await paystackClient.initializeTransaction({
    reference: paymentReference,
    amount: plan.amount,
    email: customerEmail,
    callbackUrl,
    metadata: {
      order_id: orderId,
      plan_id: plan.id,
      customer_id: customerId,
    },
  });

  await db
    .update(orders)
    .set({
      paystackAccessCode: initRes.accessCode,
      paystackAuthorizationUrl: initRes.authorizationUrl,
      updatedAt: new Date(),
    })
    .where(eq(orders.id, orderId));

  console.log('✓ Paystack transaction initialized successfully!');
  console.log('--------------------------------------------------------------------------------');
  console.log(`CHECKOUT URL: ${initRes.authorizationUrl}`);
  console.log('--------------------------------------------------------------------------------');
  console.log('OPERATOR INSTRUCTIONS:');
  console.log('1. Click or open the CHECKOUT URL above in your browser.');
  console.log('2. On the Paystack test checkout modal, select "Card" payment.');
  console.log('3. Enter Paystack test card details:');
  console.log('   - Card Number: 4084 0840 0840 0840');
  console.log('   - Expiry Date: 08/29 (or any future MM/YY)');
  console.log('   - CVV:         408');
  console.log('   - PIN:         1111');
  console.log('   - OTP:         123456');
  console.log('4. Complete payment until Paystack displays "Successful".');
  console.log('5. Once paid, run the verification command:');
  console.log(`   npx tsx scripts/verify-real-checkout.ts --case=${caseNum} --ref=${paymentReference}`);
  console.log('================================================================================');

  process.exit(0);
}

main().catch((err) => {
  console.error('[Error] Checkout initialization failed:', err);
  process.exit(1);
});
