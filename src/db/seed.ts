import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });

import { db } from './index';
import { subscriptionPlans } from './schema';
import { sql } from 'drizzle-orm';

export const DEFAULT_PLANS = [
  {
    id: 'plan_starter_monthly',
    name: 'Starter Plan (Monthly)',
    description: 'Entry-tier SaaS entitlement: up to 5 seats, 30-day fixed duration.',
    amount: 500000, // 5,000 NGN in minor units (kobo)
    currency: 'NGN',
    durationDays: 30,
    isActive: 'true',
  },
  {
    id: 'plan_pro_monthly',
    name: 'Pro Plan (Monthly)',
    description: 'Professional-tier SaaS entitlement: unlimited seats, 30-day fixed duration.',
    amount: 1500000, // 15,000 NGN in minor units (kobo)
    currency: 'NGN',
    durationDays: 30,
    isActive: 'true',
  },
];

export async function seedPlans() {
  for (const plan of DEFAULT_PLANS) {
    await db
      .insert(subscriptionPlans)
      .values(plan)
      .onConflictDoUpdate({
        target: subscriptionPlans.id,
        set: {
          name: plan.name,
          description: plan.description,
          amount: plan.amount,
          currency: plan.currency,
          durationDays: plan.durationDays,
          isActive: plan.isActive,
        },
      });
  }
}

// Auto-run if executed directly
if (process.argv[1]?.includes('seed')) {
  seedPlans()
    .then(() => {
      console.log('[Seed] Default subscription plans seeded successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[Seed] Error seeding plans:', err);
      process.exit(1);
    });
}
