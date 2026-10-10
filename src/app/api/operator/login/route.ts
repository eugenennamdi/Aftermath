import { NextRequest, NextResponse } from 'next/server';
import { verifyOperatorPassword, setOperatorCookie, validateCsrfOrOrigin } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    if (!validateCsrfOrOrigin(req)) {
      return NextResponse.json({ error: 'Untrusted origin' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const secret = body?.secret;

    if (!secret || typeof secret !== 'string') {
      return NextResponse.json(
        { error: 'Operator secret is required' },
        { status: 400 }
      );
    }

    const isValid = verifyOperatorPassword(secret);
    if (!isValid) {
      return NextResponse.json(
        { error: 'Invalid operator credentials' },
        { status: 401 }
      );
    }

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
