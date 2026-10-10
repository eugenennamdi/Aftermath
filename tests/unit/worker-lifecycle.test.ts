import { describe, it, expect } from 'vitest';
import { startWorker } from '@/worker/index';

describe('Railway Background Worker Lifecycle', () => {
  it('starts worker cleanly and allows graceful shutdown', async () => {
    const worker = await startWorker();

    expect(worker).toBeDefined();
    expect(worker.isRunning()).toBe(true);

    // Test shutdown
    await worker.shutdown('TEST_SIGNAL');
    expect(worker.isRunning()).toBe(false);
  });
});
