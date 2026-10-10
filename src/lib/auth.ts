import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

const OPERATOR_COOKIE_NAME = 'aftermath_operator_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24; // 24 hours

function getOperatorSecret(): string {
  return process.env.OPERATOR_SECRET || 'aftermath-operator-dev-secret-key-2026';
}

/**
 * Validates the operator password using constant-time comparison to prevent timing attacks.
 */
export function verifyOperatorPassword(password: string): boolean {
  if (!password || typeof password !== 'string') return false;
  const expectedSecret = getOperatorSecret();
  const inputBuffer = Buffer.from(password);
  const expectedBuffer = Buffer.from(expectedSecret);

  if (inputBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(inputBuffer, expectedBuffer);
}

/**
 * Creates a cryptographically signed session token:
 * payload = base64(json({ exp, nonce }))
 * signature = hmac_sha256(payload, secret)
 * token = `${payload}.${signature}`
 */
export function createOperatorSessionToken(): string {
  const secret = getOperatorSecret();
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const nonce = crypto.randomUUID();
  const payload = Buffer.from(JSON.stringify({ exp, nonce })).toString('base64url');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('base64url');
  return `${payload}.${signature}`;
}

/**
 * Validates the signature and expiration of an operator session token.
 */
export function verifyOperatorSessionToken(token: string | null | undefined): boolean {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;

  const [payloadB64, signature] = parts;
  const secret = getOperatorSecret();
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payloadB64)
    .digest('base64url');

  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (sigBuffer.length !== expectedBuffer.length) return false;
  if (!crypto.timingSafeEqual(sigBuffer, expectedBuffer)) return false;

  try {
    const payloadJson = Buffer.from(payloadB64, 'base64url').toString('utf8');
    const { exp } = JSON.parse(payloadJson);
    if (typeof exp !== 'number' || exp < Math.floor(Date.now() / 1000)) {
      return false; // Expired
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks if the incoming request has a valid operator session cookie.
 */
export function isOperatorAuthenticated(req: NextRequest): boolean {
  const token = req.cookies.get(OPERATOR_COOKIE_NAME)?.value;
  return verifyOperatorSessionToken(token);
}

/**
 * Sets the HttpOnly, SameSite, Secure-in-production cookie on a response.
 */
export function setOperatorCookie(res: NextResponse): void {
  const token = createOperatorSessionToken();
  const isProduction = process.env.NODE_ENV === 'production';

  res.cookies.set(OPERATOR_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}

/**
 * Clears the operator session cookie on logout.
 */
export function clearOperatorCookie(res: NextResponse): void {
  res.cookies.set(OPERATOR_COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

/**
 * Validates request origin for state-mutating requests to prevent CSRF.
 */
export function validateCsrfOrOrigin(req: NextRequest): boolean {
  // If not a mutating method, safe
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;

  const origin = req.headers.get('origin');
  const host = req.headers.get('host');
  if (!origin || !host) return true; // Direct non-browser calls / test runners

  try {
    const originHost = new URL(origin).host;
    return originHost === host;
  } catch {
    return false;
  }
}
