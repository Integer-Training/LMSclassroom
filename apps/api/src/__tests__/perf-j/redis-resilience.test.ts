import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

// Phase J (redis-offline-queue-hangs, ratelimit-redis-outage-adds-2s) — a down/stalled Redis must degrade the site,
// never hang it: process guards survive stray rejections, cache/handoff Redis calls are bounded to 1s, and the rate
// limiter fails open (no Redis call at all when not ready, circuit breaker after 2 failures, 400 ms ceiling).

const sentry = vi.hoisted(() => ({
  captureException: vi.fn(),
  flush: vi.fn(async () => true)
}));
vi.mock('@sentry/node', () => sentry);

const redisState = vi.hoisted(() => ({
  isReady: true,
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  mGet: vi.fn(),
  multi: vi.fn()
}));
vi.mock('@cio/core/utils/redis/redis', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@cio/core/utils/redis/redis')>();
  return {
    ...actual,
    redis: redisState,
    logRedisUnavailableOnce: vi.fn(),
    logTransientRedisEvent: vi.fn()
  };
});

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(
    async (_client: unknown, command: { input: { Key: string } }) => `https://signed.test/${command.input.Key}`
  )
}));
vi.mock('@cio/core/config/storage', () => ({
  getPresignS3Client: () => ({}),
  getS3Client: () => ({}),
  getStorageConfig: () => ({ presignDownloadExpiresSeconds: 60 })
}));

vi.mock('@cio/core/config/env', () => ({ env: { NODE_ENV: 'production', PRIVATE_SERVER_KEY: 'server-key' } }));

const limiter = vi.hoisted(() => ({ isAllowed: vi.fn() }));
vi.mock('@api/utils/redis/limiter', () => ({
  RedisRateLimiter: class {
    isAllowed = limiter.isAllowed;
  }
}));

import { isTransientRedisError } from '@cio/core/utils/redis/redis';
import { generateDownloadPresignedUrls } from '@cio/core/utils/s3';
import { registerProcessErrorGuards } from '@api/process-error-guards';
import { consumeHandoffPayload, storeHandoffPayload } from '@api/utils/redis/oauth-handoff';
import { createRateLimiter, resetRateLimitBreaker } from '@api/middlewares/rate-limiter';

afterEach(() => {
  vi.useRealTimers();
});

describe('isTransientRedisError', () => {
  it('treats "The client is offline" (offline queue disabled) as transient', () => {
    expect(isTransientRedisError(new Error('The client is offline'))).toBe(true);
    expect(isTransientRedisError(new Error('Connection is closed.'))).toBe(true);
    expect(isTransientRedisError(new Error('a genuine bug'))).toBe(false);
  });
});

describe('process error guards', () => {
  const handlers: Record<string, (arg: unknown) => void> = {};
  let exit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, 'on').mockImplementation(((event: string, fn: (arg: unknown) => void) => {
      handlers[event] = fn;
      return process;
    }) as never);
    exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerProcessErrorGuards();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('an unhandled rejection is logged + reported to Sentry and does NOT exit the process', () => {
    handlers.unhandledRejection!(new Error('late s3 call failed'));

    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled();
  });

  it('a transient Redis rejection is ignored entirely', () => {
    handlers.unhandledRejection!(new Error('The client is offline'));

    expect(sentry.captureException).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  it('an uncaught exception still reports, flushes and exits 1', async () => {
    handlers.uncaughtException!(new Error('corrupt state'));
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));

    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    expect(sentry.flush).toHaveBeenCalled();
  });

  it('a transient Redis uncaught exception does not exit', () => {
    handlers.uncaughtException!(new Error('The client is offline'));

    expect(exit).not.toHaveBeenCalled();
  });
});

describe('Redis cache/handoff calls are bounded to 1s', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  it('consumeHandoffPayload gives up on a stalled GET (null) instead of hanging', async () => {
    redisState.get.mockReturnValue(new Promise(() => {}));

    const pending = consumeHandoffPayload('tok');
    await vi.advanceTimersByTimeAsync(1_100);

    await expect(pending).resolves.toBeNull();
  });

  it('storeHandoffPayload rejects with the existing error on a stalled SET instead of hanging', async () => {
    redisState.set.mockReturnValue(new Promise(() => {}));

    const pending = storeHandoffPayload('tok', 'payload');
    const assertion = expect(pending).rejects.toThrow('Failed to store OAuth handoff payload');
    await vi.advanceTimersByTimeAsync(1_100);

    await assertion;
  });

  it('a healthy Redis is unaffected', async () => {
    redisState.get.mockResolvedValue('payload');
    redisState.del.mockResolvedValue(1);

    await expect(consumeHandoffPayload('tok')).resolves.toBe('payload');
    expect(redisState.del).toHaveBeenCalled();
  });
});

describe('presigned URLs survive a stalled Redis cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  it('falls back to signing fresh URLs when the cache read AND write both stall', async () => {
    redisState.mGet.mockReturnValue(new Promise(() => {}));
    redisState.multi.mockReturnValue({ setEx: vi.fn(), exec: vi.fn(() => new Promise(() => {})) });

    const pending = generateDownloadPresignedUrls(['lesson/a.pdf'], 'documents');
    await vi.advanceTimersByTimeAsync(2_300);

    await expect(pending).resolves.toEqual({ 'lesson/a.pdf': 'https://signed.test/lesson/a.pdf' });
  });
});

describe('rate limiter fail-open + circuit breaker', () => {
  const makeApp = () => {
    const app = new Hono();
    app.use('*', createRateLimiter({ keyGenerator: () => 'k', maxRequests: 5, windowMs: 1_000 }));
    app.get('/x', (c) => c.text('ok'));
    return app;
  };
  const allowed = { allowed: true, remaining: 4, resetTime: Date.now() + 1_000 };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-28T12:00:00Z'));
    redisState.isReady = true;
    resetRateLimitBreaker();
  });

  it('skips Redis entirely when it is not ready (outage adds no latency)', async () => {
    redisState.isReady = false;

    const res = await makeApp().request('/x');

    expect(res.status).toBe(200);
    expect(limiter.isAllowed).not.toHaveBeenCalled();
  });

  it('still enforces the limit when Redis is healthy (429 with Retry-After)', async () => {
    limiter.isAllowed.mockResolvedValue({ allowed: false, remaining: 0, resetTime: Date.now() + 30_000 });

    const res = await makeApp().request('/x');

    expect(res.status).toBe(429);
  });

  it('opens the breaker after 2 consecutive failures, skips Redis for 15s, then retries', async () => {
    limiter.isAllowed.mockRejectedValue(new Error('boom'));
    const app = makeApp();

    expect((await app.request('/x')).status).toBe(200); // failure 1 -> fail open
    expect((await app.request('/x')).status).toBe(200); // failure 2 -> breaker opens
    expect(limiter.isAllowed).toHaveBeenCalledTimes(2);

    expect((await app.request('/x')).status).toBe(200);
    expect(limiter.isAllowed).toHaveBeenCalledTimes(2); // breaker open: Redis not touched

    vi.advanceTimersByTime(15_001);
    limiter.isAllowed.mockResolvedValue(allowed);
    expect((await app.request('/x')).status).toBe(200);
    expect(limiter.isAllowed).toHaveBeenCalledTimes(3); // cool-off over: Redis is consulted again
  });

  it('a success resets the failure count (isolated blips never open the breaker)', async () => {
    const app = makeApp();
    limiter.isAllowed.mockRejectedValueOnce(new Error('blip'));
    await app.request('/x');
    limiter.isAllowed.mockResolvedValueOnce(allowed);
    await app.request('/x');
    limiter.isAllowed.mockRejectedValueOnce(new Error('blip'));
    await app.request('/x');

    limiter.isAllowed.mockResolvedValue(allowed);
    await app.request('/x');
    expect(limiter.isAllowed).toHaveBeenCalledTimes(4); // breaker never opened
  });

  it('a stalled check fails open after 400 ms, not 2 s', async () => {
    limiter.isAllowed.mockReturnValue(new Promise(() => {}));

    const pending = makeApp().request('/x');
    await vi.advanceTimersByTimeAsync(450);
    const res = await pending;

    expect(res.status).toBe(200);
  });

  it('the downstream handler runs exactly once even when the check fails', async () => {
    limiter.isAllowed.mockRejectedValue(new Error('boom'));
    const downstream = vi.fn();
    const app = new Hono();
    app.use('*', createRateLimiter({ keyGenerator: () => 'k' }));
    app.get('/x', (c) => {
      downstream();
      return c.text('ok');
    });

    await app.request('/x');

    expect(downstream).toHaveBeenCalledTimes(1);
  });
});
