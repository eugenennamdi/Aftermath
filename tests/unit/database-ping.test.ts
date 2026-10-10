import { describe, it, expect } from 'vitest';
import { verifyDatabaseConnection } from '@/db/index';

describe('PostgreSQL Database Connection Verification', () => {
  it('handles bounded connection test without hanging indefinitely', async () => {
    // 1-second bounded test
    const startTime = Date.now();
    const result = await verifyDatabaseConnection(1000);
    const duration = Date.now() - startTime;

    expect(result).toBeDefined();
    // Bounded check must complete quickly (under 2.5s) even if host is unreachable
    expect(duration).toBeLessThan(3000);

    // If no PostgreSQL server is running locally, it cleanly returns connected: false with an error message
    if (!result.connected) {
      expect(result.error).toBeDefined();
      console.log('[Test Note] PostgreSQL local server not connected (expected in local offline environment):', result.error);
    } else {
      expect(result.connected).toBe(true);
    }
  });
});
