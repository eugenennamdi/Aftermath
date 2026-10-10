import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

export const OPERATOR_COOKIE_NAME = 'aftermath_operator_session';
export const SESSION_TTL_SECONDS = 60 * 60 * 24; // 24 hours
export const MIN_OPERATOR_SECRET_LENGTH = 16;
export const MAX_OPERATOR_INPUT_LENGTH = 256;

// In-memory rate limiting map for login throttling: ip -> { attempts, resetAt }
const loginAttemptMap = new Map<string, { attempts: number; resetAt: number }>();
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_RATE_WINDOW_MS = 60 * 1000; // 60 seconds

/**
 * Returns the operator secret from environment or null if missing/inadequate.
 * Strictly FAILS CLOSED: no default dev secret is allowed in source control.
 */
export function getOperatorSecret(): string | null {
  const secret = process.env.OPERATOR_SECRET;
  if (!secret || typeof secret !== 'string') {
    return null;
  }
  const trimmed = secret.trim();
  if (trimmed.length < MIN_OPERATOR_SECRET_LENGTH) {
    return null;
  }
  return trimmed;
}

/**
 * Checks in-memory rate limiting for login attempts per IP.
 */
export function checkLoginRateLimit(clientIp: string): { allowed: boolean; retryAfterSeconds?: number } {
  const now = Date.now();
  const record = loginAttemptMap.get(clientIp);

  if (!record || now > record.resetAt) {
    return { allowed: true };
  }

  if (record.attempts >= MAX_LOGIN_ATTEMPTS) {
    const retryAfter = Math.ceil((record.resetAt - now) / 1000);
    return { allowed: false, retryAfterSeconds: Math.max(retryAfter, 1) };
  }

  return { allowed: true };
}

/**
 * Records a successful or failed login attempt to throttle brute force.
 */
export function recordLoginAttempt(clientIp: string, success: boolean): void {
  const now = Date.now();
  if (success) {
    loginAttemptMap.delete(clientIp);
    return;
  }

  const record = loginAttemptMap.get(clientIp);
  if (!record || now > record.resetAt) {
    loginAttemptMap.set(clientIp, { attempts: 1, resetAt: now + LOGIN_RATE_WINDOW_MS });
  } else {
    record.attempts += 1;
  }
}

/**
 * Resets the in-memory login attempts table (used in testing).
 */
export function resetLoginRateLimits(): void {
  loginAttemptMap.clear();
}

/**
 * Validates the operator password using constant-time comparison to prevent timing attacks.
 * Fails closed if OPERATOR_SECRET is missing or inadequate.
 */
export function verifyOperatorPassword(password: string): boolean {
  if (!password || typeof password !== 'string') return false;
  if (password.length > MAX_OPERATOR_INPUT_LENGTH) return false;

  const expectedSecret = getOperatorSecret();
  if (!expectedSecret) {
    // FAIL CLOSED: No valid secret configured
    return false;
  }

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
  if (!secret) {
    throw new Error('OPERATOR_SECRET is missing or shorter than 16 characters. Refusing to mint session token.');
  }

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
 * Fails closed if OPERATOR_SECRET is missing or token is invalid.
 */
export function verifyOperatorSessionToken(token: string | null | undefined): boolean {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;

  const secret = getOperatorSecret();
  if (!secret) {
    return false; // Fail closed
  }

  const [payloadB64, signature] = parts;
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

export const MIN_CRON_SECRET_LENGTH = 16;

/**
 * Returns the configured CRON_SECRET or null if missing/inadequate.
 * Fails closed: minimum 16 characters required.
 */
export function getCronSecret(): string | null {
  const secret = process.env.CRON_SECRET;
  if (!secret || typeof secret !== 'string') return null;
  const trimmed = secret.trim();
  if (trimmed.length < MIN_CRON_SECRET_LENGTH) return null;
  return trimmed;
}

/**
 * Verifies if the request provides a valid CRON_SECRET via Authorization Bearer or x-cron-secret header.
 * Uses constant-time equality check to prevent timing attacks.
 */
export function isWorkerCronAuthorized(req: NextRequest): boolean {
  const expectedSecret = getCronSecret();
  if (!expectedSecret) return false;

  const authHeader = req.headers.get('authorization');
  const xCronHeader = req.headers.get('x-cron-secret');

  let candidate: string | null = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    candidate = authHeader.slice(7).trim();
  } else if (xCronHeader) {
    candidate = xCronHeader.trim();
  }

  if (!candidate) return false;

  const inputBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expectedSecret);
  if (inputBuffer.length !== expectedBuffer.length) return false;

  return crypto.timingSafeEqual(inputBuffer, expectedBuffer);
}

// In-memory rate limiting map for checkout initialization per IP: ip -> { count, resetAt }
const checkoutAttemptMap = new Map<string, { count: number; resetAt: number }>();
const MAX_CHECKOUT_ATTEMPTS = 10;
const CHECKOUT_RATE_WINDOW_MS = 60 * 1000; // 60 seconds

/**
 * Checks in-memory rate limiting for checkout initialization per IP.
 */
export function checkCheckoutRateLimit(clientIp: string): { allowed: boolean; retryAfterSeconds?: number } {
  const now = Date.now();
  const record = checkoutAttemptMap.get(clientIp);

  if (!record || now > record.resetAt) {
    checkoutAttemptMap.set(clientIp, { count: 1, resetAt: now + CHECKOUT_RATE_WINDOW_MS });
    return { allowed: true };
  }

  if (record.count >= MAX_CHECKOUT_ATTEMPTS) {
    const retryAfter = Math.ceil((record.resetAt - now) / 1000);
    return { allowed: false, retryAfterSeconds: Math.max(retryAfter, 1) };
  }

  record.count += 1;
  return { allowed: true };
}

/**
 * Resets checkout rate limits (used in testing).
 */
export function resetCheckoutRateLimits(): void {
  checkoutAttemptMap.clear();
}

/**
 * Checks if the incoming request has a valid test checkout authorization header.
 * Accepts x-checkout-secret or Bearer token matching CRON_SECRET or OPERATOR_SECRET.
 */
export function isTestCheckoutAuthorized(req: NextRequest): boolean {
  const authHeader = req.headers.get('authorization');
  const xCheckoutHeader = req.headers.get('x-checkout-secret');

  let candidate: string | null = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    candidate = authHeader.slice(7).trim();
  } else if (xCheckoutHeader) {
    candidate = xCheckoutHeader.trim();
  }

  if (!candidate) return false;

  const validSecrets = [getOperatorSecret(), getCronSecret()].filter(
    (s): s is string => typeof s === 'string' && s.length >= MIN_OPERATOR_SECRET_LENGTH
  );

  if (validSecrets.length === 0) return false;

  const candBuf = Buffer.from(candidate);
  for (const secret of validSecrets) {
    const secBuf = Buffer.from(secret);
    if (candBuf.length === secBuf.length && crypto.timingSafeEqual(candBuf, secBuf)) {
      return true;
    }
  }

  return false;
}

/**
 * Derives the explicit set of trusted origins from environment.
 * Matches scheme, host, and port exactly.
 * In production (NODE_ENV === 'production'), FAILS CLOSED if no origin is configured.
 */
export function getTrustedOrigins(): Set<string> {
  const origins = new Set<string>();

  const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl) {
    try {
      origins.add(new URL(appUrl).origin);
    } catch {
      // Invalid URL
    }
  }

  const extraOrigins = process.env.TRUSTED_ORIGINS;
  if (extraOrigins) {
    for (const item of extraOrigins.split(',')) {
      const trimmed = item.trim();
      if (trimmed) {
        try {
          origins.add(new URL(trimmed).origin);
        } catch {
          // Invalid origin
        }
      }
    }
  }

  // Default to standard local host origins ONLY in non-production mode
  if (origins.size === 0 && process.env.NODE_ENV !== 'production') {
    origins.add('http://localhost:3000');
    origins.add('http://127.0.0.1:3000');
  }

  return origins;
}

/**
 * Validates request origin for state-mutating requests to prevent CSRF.
 * Strictly checks Origin against APP_URL / TRUSTED_ORIGINS.
 * REJECTS arbitrary Host header matching to prevent host spoofing and cross-port attacks.
 * Fails closed when no trusted origin is configured in production.
 * Requires strict configured-origin validation for cookie-authenticated browser mutations.
 */
export function validateCsrfOrOrigin(req: NextRequest): boolean {
  // Safe HTTP read methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;

  const trustedOrigins = getTrustedOrigins();
  if (trustedOrigins.size === 0) {
    // Fail closed when no trusted origin is configured
    return false;
  }

  const origin = req.headers.get('origin');
  if (origin) {
    try {
      const originUrl = new URL(origin);
      // Strictly match exact origin: scheme + hostname + port
      return trustedOrigins.has(originUrl.origin);
    } catch {
      return false;
    }
  }

  // If no Origin header, inspect Referer header if present
  const referer = req.headers.get('referer');
  if (referer) {
    try {
      const refUrl = new URL(referer);
      return trustedOrigins.has(refUrl.origin);
    } catch {
      return false;
    }
  }

  // Strict: browser requests authenticated via operator session cookie MUST provide an Origin/Referer.
  // Missing-Origin browser mutations with operator cookies are strictly rejected to prevent CSRF.
  const hasOperatorCookie = Boolean(req.cookies.get(OPERATOR_COOKIE_NAME)?.value);
  if (hasOperatorCookie) {
    return false;
  }

  // Server-to-server requests without browser cookies must use an explicitly separate authorization method
  if (isWorkerCronAuthorized(req) || isTestCheckoutAuthorized(req)) {
    return true;
  }

  // In non-production test environment only: allow server-side synthetic test mutations if no cookie
  if (process.env.NODE_ENV === 'test') {
    return true;
  }

  return false;
}

