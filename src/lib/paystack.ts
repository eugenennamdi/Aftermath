import crypto from 'node:crypto';
import { sanitizeTelemetryPayload } from './neatlogs';

const PAYSTACK_API_BASE = 'https://api.paystack.co';

export interface PaystackInitializeParams {
  reference: string;
  amount: number; // in minor units (kobo)
  email: string;
  callbackUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface PaystackInitializeResponse {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
}

export type PaystackVerificationOutcome =
  | {
      outcome: 'SUCCESS';
      reference: string;
      amount: number; // in minor units
      currency: string;
      customerEmail: string;
      paidAt: Date;
      channel?: string;
      gatewayResponse?: string;
      rawData: Record<string, unknown>;
    }
  | {
      outcome: 'PENDING';
      reference: string;
      gatewayResponse?: string;
    }
  | {
      outcome: 'FAILED';
      reference: string;
      gatewayResponse?: string;
    }
  | {
      outcome: 'API_ERROR';
      reference: string;
      error: string;
      statusCode?: number;
      retryable: boolean;
    }
  | {
      outcome: 'MALFORMED';
      reference: string;
      error: string;
    };

/**
 * Scoped Verification Adapter Interface for Paystack transactions.
 * Allows safe, dependency-injected test fixtures without mutating global state.
 */
export interface PaystackVerificationAdapter {
  hasSecretKey(): boolean;
  verifyTransaction(reference: string): Promise<PaystackVerificationOutcome>;
  readonly adapterType?: 'LIVE_HTTP' | 'SCOPED_FIXTURE';
}

/**
 * Generates a cryptographically unpredictable reference compatible with Paystack format.
 * Paystack permits alphanumeric characters, hyphens, periods, and equals signs: ^[a-zA-Z0-9.\-=]+$
 * Format: ref-<timestamp36>-<16-char-entropy> (contains strictly alphanumeric and hyphens; zero underscores)
 */
export function generatePaystackReference(): string {
  const timestamp = Date.now().toString(36);
  const entropy = crypto.randomBytes(8).toString('hex');
  return `ref-${timestamp}-${entropy}`;
}

/**
 * Validates whether a reference conforms to Paystack format requirements.
 */
export function isValidPaystackReference(reference: string): boolean {
  if (!reference || typeof reference !== 'string') return false;
  if (reference.length < 4 || reference.length > 100) return false;
  return /^[a-zA-Z0-9.\-=]+$/.test(reference);
}

/**
 * Paystack API Client & Verification Adapter
 * Server-only module; guarantees PAYSTACK_SECRET_KEY never leaves server environment.
 */
export class PaystackClient implements PaystackVerificationAdapter {
  public readonly adapterType = 'LIVE_HTTP' as const;
  private readonly secretKey: string;
  private readonly customFetch?: typeof fetch;

  constructor(secretKey?: string, customFetch?: typeof fetch) {
    this.secretKey = secretKey || '';
    this.customFetch = customFetch;
  }

  private getFetch(): typeof fetch {
    return this.customFetch || fetch;
  }

  public getSecretKey(): string {
    return this.secretKey || process.env.PAYSTACK_SECRET_KEY || '';
  }

  /**
   * Validates if secret key is configured.
   */
  public hasSecretKey(): boolean {
    const key = this.getSecretKey();
    return Boolean(key && key.trim().length > 0);
  }

  /**
   * Initializes a transaction on Paystack.
   */
  public async initializeTransaction(
    params: PaystackInitializeParams
  ): Promise<PaystackInitializeResponse> {
    const key = this.getSecretKey();
    if (!key) {
      throw new Error('PAYSTACK_SECRET_KEY is not configured.');
    }

    const endpoint = `${PAYSTACK_API_BASE}/transaction/initialize`;
    const payload = {
      reference: params.reference,
      amount: params.amount,
      email: params.email,
      callback_url: params.callbackUrl,
      metadata: params.metadata,
    };

    try {
      const response = await this.getFetch()(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Paystack initialization failed with HTTP ${response.status}: ${errorText}`
        );
      }

      const body = (await response.json()) as {
        status: boolean;
        message: string;
        data?: {
          authorization_url: string;
          access_code: string;
          reference: string;
        };
      };

      if (!body.status || !body.data) {
        throw new Error(
          `Paystack returned unconfirmed initialization: ${body.message || 'unknown error'}`
        );
      }

      if (body.data.reference !== params.reference) {
        throw new Error(
          `Paystack reference mismatch: expected ${params.reference}, received ${body.data.reference}`
        );
      }

      return {
        authorizationUrl: body.data.authorization_url,
        accessCode: body.data.access_code,
        reference: body.data.reference,
      };
    } catch (err) {
      const message = (err as Error).message || String(err);
      throw new Error(`Paystack transaction initialization failed: ${message}`);
    }
  }

  /**
   * Verifies transaction status directly from Paystack API.
   * Returns explicit, typed outcome categories.
   */
  public async verifyTransaction(
    reference: string
  ): Promise<PaystackVerificationOutcome> {
    if (!this.hasSecretKey()) {
      return {
        outcome: 'API_ERROR',
        reference,
        error: 'PAYSTACK_SECRET_KEY is missing.',
        retryable: false,
      };
    }

    const endpoint = `${PAYSTACK_API_BASE}/transaction/verify/${encodeURIComponent(reference)}`;

    try {
      const key = this.getSecretKey();
      const response = await this.getFetch()(endpoint, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const isTransient = response.status >= 500 || response.status === 429;
        const errorText = await response.text().catch(() => '');
        return {
          outcome: 'API_ERROR',
          reference,
          error: `HTTP ${response.status}: ${errorText}`,
          statusCode: response.status,
          retryable: isTransient,
        };
      }

      const body = (await response.json()) as {
        status?: boolean;
        message?: string;
        data?: {
          status?: string;
          reference?: string;
          amount?: number;
          currency?: string;
          customer?: { email?: string };
          paid_at?: string;
          channel?: string;
          gateway_response?: string;
          [key: string]: unknown;
        };
      };

      if (!body || typeof body !== 'object') {
        return {
          outcome: 'MALFORMED',
          reference,
          error: 'Paystack response body is not a JSON object.',
        };
      }

      if (!body.status || !body.data) {
        return {
          outcome: 'FAILED',
          reference,
          gatewayResponse: body.message || 'Transaction verification returned false status',
        };
      }

      const data = body.data;
      const txStatus = data.status?.toLowerCase();

      if (txStatus === 'success') {
        if (
          typeof data.amount !== 'number' ||
          !data.currency ||
          !data.customer?.email
        ) {
          return {
            outcome: 'MALFORMED',
            reference,
            error: 'Missing required fields (amount, currency, customer email) in success payload.',
          };
        }

        return {
          outcome: 'SUCCESS',
          reference: data.reference || reference,
          amount: data.amount,
          currency: data.currency.toUpperCase(),
          customerEmail: data.customer.email.toLowerCase(),
          paidAt: data.paid_at ? new Date(data.paid_at) : new Date(),
          channel: data.channel,
          gatewayResponse: data.gateway_response,
          rawData: sanitizeTelemetryPayload(data),
        };
      }

      if (txStatus === 'pending' || txStatus === 'ongoing') {
        return {
          outcome: 'PENDING',
          reference,
          gatewayResponse: data.gateway_response || 'Payment pending',
        };
      }

      return {
        outcome: 'FAILED',
        reference,
        gatewayResponse: data.gateway_response || `Payment status: ${txStatus}`,
      };
    } catch (err) {
      const error = (err as Error).message || String(err);
      return {
        outcome: 'API_ERROR',
        reference,
        error: `Network/transport error: ${error}`,
        retryable: true,
      };
    }
  }

  /**
   * Validates Paystack webhook HMAC-SHA512 signature in constant time.
   */
  public verifyWebhookSignature(
    rawBody: string | Buffer,
    signatureHeader: string | null | undefined
  ): boolean {
    const key = this.getSecretKey();
    if (!signatureHeader || !this.hasSecretKey()) {
      return false;
    }

    const normalizedHeader = signatureHeader.trim().toLowerCase();
    const computedHmac = crypto
      .createHmac('sha512', key)
      .update(rawBody)
      .digest('hex')
      .toLowerCase();

    // Constant-time comparison with exact byte length protection
    const headerBuffer = Buffer.from(normalizedHeader, 'utf-8');
    const computedBuffer = Buffer.from(computedHmac, 'utf-8');

    if (headerBuffer.length !== computedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(headerBuffer, computedBuffer);
  }
}

// Default singleton client
export const paystackClient = new PaystackClient();
