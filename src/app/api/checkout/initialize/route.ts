import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createTrustedOrder } from '@/services/order';
import {
  validateCsrfOrOrigin,
  isOperatorAuthenticated,
  isTestCheckoutAuthorized,
  checkCheckoutRateLimit,
} from '@/lib/auth';

// Explicit allowlist of plans permitted for checkout initialization in demo/test mode
const AUTHORIZED_DEMO_PLANS = new Set([
  'plan_starter_monthly',
  'plan_pro_monthly',
]);

const MAX_CHECKOUT_BODY_BYTES = 4096;

const CheckoutRequestSchema = z.object({
  planId: z.string().min(1).max(64),
  customerEmail: z.string().email().max(128),
  customerName: z.string().max(128).optional(),
  callbackUrl: z.string().max(256).optional(),
});

export async function POST(req: NextRequest) {
  try {
    // 1. Strict CSRF & origin validation
    if (!validateCsrfOrOrigin(req)) {
      return NextResponse.json({ error: 'Untrusted origin' }, { status: 403 });
    }

    // 2. Strict authorization: requires authorized operator session OR authorized test checkout token
    const isAuth = isOperatorAuthenticated(req) || isTestCheckoutAuthorized(req);
    if (!isAuth) {
      return NextResponse.json(
        { error: 'Unauthorized: Operator session or test checkout secret required' },
        { status: 401 }
      );
    }

    // 3. Client IP rate limiting (anti-abuse)
    const clientIp =
      req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      req.headers.get('x-real-ip') ||
      '127.0.0.1';
    const rateLimit = checkCheckoutRateLimit(clientIp);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: `Checkout rate limit exceeded. Retry after ${rateLimit.retryAfterSeconds}s.` },
        {
          status: 429,
          headers: { 'Retry-After': String(rateLimit.retryAfterSeconds || 60) },
        }
      );
    }

    // 4. Bound body payload size
    const contentLength = req.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_CHECKOUT_BODY_BYTES) {
      return NextResponse.json(
        { error: 'Payload exceeds maximum allowed size' },
        { status: 413 }
      );
    }

    const body: unknown = await req.json();
    const parsed = CheckoutRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid checkout request', details: parsed.error.issues },
        { status: 400 }
      );
    }

    const { planId, customerEmail, customerName, callbackUrl } = parsed.data;

    // Boundary check: ensure checkout is restricted to authorized demo/test plans
    if (!AUTHORIZED_DEMO_PLANS.has(planId)) {
      return NextResponse.json(
        {
          error: `Checkout initialization is restricted to authorized test/demo plans. Plan "${planId}" is unauthorized.`,
        },
        { status: 403 }
      );
    }

    const checkout = await createTrustedOrder({
      planId,
      customerEmail,
      customerName,
      callbackUrl,
    });

    return NextResponse.json({
      success: true,
      order: {
        id: checkout.orderId,
        ...checkout,
      },
    });
  } catch (err) {
    const message = (err as Error).message || 'Checkout initialization failed';
    const status = message.includes('does not exist') ? 404 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
