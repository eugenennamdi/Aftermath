import { describe, it, expect, vi } from 'vitest';
import crypto from 'node:crypto';
import { PaystackClient } from '@/lib/paystack';

describe('Paystack Verification Adapter & Provider Fault Resilience', () => {
  const secretKey = 'sk_test_mock_secret_key_1234567890';

  it('correctly parses successful verification payload', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: true,
        message: 'Verification successful',
        data: {
          status: 'success',
          reference: 'ref_123',
          amount: 500000,
          currency: 'NGN',
          customer: { email: 'user@example.com' },
          paid_at: '2026-10-10T08:00:00.000Z',
          gateway_response: 'Approved',
          channel: 'card',
        },
      }),
    } as unknown as Response);

    const client = new PaystackClient(secretKey, mockFetch);
    const result = await client.verifyTransaction('ref_123');

    expect(result.outcome).toBe('SUCCESS');
    if (result.outcome === 'SUCCESS') {
      expect(result.reference).toBe('ref_123');
      expect(result.amount).toBe(500000);
      expect(result.currency).toBe('NGN');
      expect(result.customerEmail).toBe('user@example.com');
    }
  });

  it('categorizes pending transactions without granting access (Requirement 6)', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: true,
        message: 'Transaction pending',
        data: {
          status: 'pending',
          reference: 'ref_pending_123',
          gateway_response: 'Waiting for customer OTP',
        },
      }),
    } as unknown as Response);

    const client = new PaystackClient(secretKey, mockFetch);
    const result = await client.verifyTransaction('ref_pending_123');

    expect(result.outcome).toBe('PENDING');
    if (result.outcome === 'PENDING') {
      expect(result.gatewayResponse).toContain('Waiting for customer OTP');
    }
  });

  it('categorizes failed/abandoned transactions without granting access (Requirement 6)', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: true,
        message: 'Transaction failed',
        data: {
          status: 'failed',
          reference: 'ref_failed_123',
          gateway_response: 'Insufficient funds',
        },
      }),
    } as unknown as Response);

    const client = new PaystackClient(secretKey, mockFetch);
    const result = await client.verifyTransaction('ref_failed_123');

    expect(result.outcome).toBe('FAILED');
    if (result.outcome === 'FAILED') {
      expect(result.gatewayResponse).toContain('Insufficient funds');
    }
  });

  it('handles provider outages (HTTP 502/503) as retryable API_ERROR, not false payment failure (Requirement 12)', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'Service Unavailable: upstream database overloaded',
    } as unknown as Response);

    const client = new PaystackClient(secretKey, mockFetch);
    const result = await client.verifyTransaction('ref_outage_123');

    expect(result.outcome).toBe('API_ERROR');
    if (result.outcome === 'API_ERROR') {
      expect(result.statusCode).toBe(503);
      expect(result.retryable).toBe(true);
      expect(result.error).toContain('HTTP 503');
    }
  });

  it('handles transport/network exceptions safely without crashing', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('ETIMEDOUT: Connection timed out'));

    const client = new PaystackClient(secretKey, mockFetch);
    const result = await client.verifyTransaction('ref_timeout_123');

    expect(result.outcome).toBe('API_ERROR');
    if (result.outcome === 'API_ERROR') {
      expect(result.retryable).toBe(true);
      expect(result.error).toContain('ETIMEDOUT');
    }
  });

  it('handles malformed responses with missing required fields', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: true,
        data: {
          status: 'success',
          // missing amount, currency, and customer!
        },
      }),
    } as unknown as Response);

    const client = new PaystackClient(secretKey, mockFetch);
    const result = await client.verifyTransaction('ref_corrupted_123');

    expect(result.outcome).toBe('MALFORMED');
  });

  it('validates webhook HMAC-SHA512 signatures accurately and rejects forged signatures', () => {
    const client = new PaystackClient(secretKey);
    const payload = JSON.stringify({ event: 'charge.success', data: { reference: 'ref_sig_123' } });

    // Valid signature
    const validSignature = crypto
      .createHmac('sha512', secretKey)
      .update(payload)
      .digest('hex');

    expect(client.verifyWebhookSignature(payload, validSignature)).toBe(true);

    // Forged signature
    const forgedSignature = crypto
      .createHmac('sha512', 'wrong_secret_key')
      .update(payload)
      .digest('hex');

    expect(client.verifyWebhookSignature(payload, forgedSignature)).toBe(false);

    // Mismatched length / invalid string
    expect(client.verifyWebhookSignature(payload, 'short_signature')).toBe(false);
    expect(client.verifyWebhookSignature(payload, null)).toBe(false);
  });
});
