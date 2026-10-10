import { NextRequest, NextResponse } from 'next/server';
import {
  verifyOperatorPassword,
  setOperatorCookie,
  validateCsrfOrOrigin,
  checkLoginRateLimit,
  recordLoginAttempt,
  MAX_OPERATOR_INPUT_LENGTH,
} from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    if (!validateCsrfOrOrigin(req)) {
      return NextResponse.json({ error: 'Untrusted origin' }, { status: 403 });
    }

    const clientIp =
      req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      req.headers.get('x-real-ip') ||
      '127.0.0.1';

    // 1. Enforce login rate limiting per IP
    const rateLimit = checkLoginRateLimit(clientIp);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          error: `Too many failed login attempts. Please retry after ${rateLimit.retryAfterSeconds}s.`,
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(rateLimit.retryAfterSeconds || 60),
          },
        }
      );
    }

    // 2. Bound request body input
    const body = await req.json().catch(() => ({}));
    const secret = body?.secret;

    if (!secret || typeof secret !== 'string') {
      return NextResponse.json(
        { error: 'Operator secret is required' },
        { status: 400 }
      );
    }

    if (secret.length > MAX_OPERATOR_INPUT_LENGTH) {
      return NextResponse.json(
        { error: 'Operator secret exceeds maximum allowed length' },
        { status: 400 }
      );
    }

    // 3. Constant-time credential verification (fails closed if OPERATOR_SECRET is missing)
    const isValid = verifyOperatorPassword(secret);
    if (!isValid) {
      recordLoginAttempt(clientIp, false);
      return NextResponse.json(
        { error: 'Invalid operator credentials' },
        { status: 401 }
      );
    }

    // Login successful
    recordLoginAttempt(clientIp, true);

    const res = NextResponse.json({
      success: true,
      authenticated: true,
      message: 'Operator session unlocked',
    });

    setOperatorCookie(res);
    return res;
  } catch (err) {
    console.error('[API /operator/login] Error:', err);
    return NextResponse.json(
      { error: 'Authentication failed' },
      { status: 500 }
    );
  }
}
