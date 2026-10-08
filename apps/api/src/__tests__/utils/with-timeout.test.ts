import { describe, expect, it, vi } from 'vitest';

import { TimeoutError, withTimeout } from '@api/utils/with-timeout';

describe('withTimeout', () => {
  it('resolves with the value when the promise settles before the timeout', async () => {
    const result = await withTimeout(Promise.resolve('ok'), 1_000, 'fast op');
    expect(result).toBe('ok');
  });

  it('propagates a rejection that happens before the timeout', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 1_000, 'failing op')).rejects.toThrow('boom');
  });

  it('rejects with TimeoutError when the promise is slower than the timeout', async () => {
    const slow = new Promise((resolve) => setTimeout(() => resolve('late'), 100));
    await expect(withTimeout(slow, 10, 'slow op')).rejects.toBeInstanceOf(TimeoutError);
  });

  it('does not leave an unhandled rejection when the loser rejects after the timeout', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);

    // Work that both loses the race AND rejects afterwards — must be swallowed internally.
    const losing = new Promise((_, reject) => setTimeout(() => reject(new Error('late failure')), 30));
    await expect(withTimeout(losing, 5, 'slow failing op')).rejects.toBeInstanceOf(TimeoutError);

    // Give the loser time to reject.
    await new Promise((resolve) => setTimeout(resolve, 60));
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});
