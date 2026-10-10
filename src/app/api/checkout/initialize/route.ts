import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createTrustedOrder } from '@/services/order';

const CheckoutRequestSchema = z.object({
  planId: z.string().min(1),
  customerEmail: z.string().email(),
  customerName: z.string().optional(),
  callbackUrl: z.string().url().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body: unknown = await req.json();
    const parsed = CheckoutRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid checkout request', details: parsed.error.issues },
        { status: 400 }
      );
    }

    const { planId, customerEmail, customerName, callbackUrl } = parsed.data;

    const checkout = await createTrustedOrder({
      planId,
      customerEmail,
      customerName,
      callbackUrl,
    });

    return NextResponse.json({
      success: true,
      order: checkout,
    });
  } catch (err) {
    const message = (err as Error).message || 'Checkout initialization failed';
    const status = message.includes('does not exist') ? 404 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
