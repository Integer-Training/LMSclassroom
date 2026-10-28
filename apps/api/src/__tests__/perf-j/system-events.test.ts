import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

// Phase J (api-error-event-amplifier, event-log-write-amplification, process-exits) — a failing endpoint writes ONE
// system_event_log row per (eventType, path, status) per minute (with a suppressed count), security events are never
// sampled, 401/403/404 are never recorded, and handleError reports 5xx.

vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
  process.env.PRIVATE_DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
});

const insert = vi.hoisted(() => ({ insertSystemEvent: vi.fn(async () => undefined) }));
vi.mock('@cio/db/queries/system-events/system-events', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@cio/db/queries/system-events/system-events')>();
  return { ...actual, ...insert };
});

import { recordSystemEvent, resetSystemEventThrottle } from '@cio/db';

const apiError = (over: Record<string, unknown> = {}) => ({
  eventType: 'api.error',
  severity: 'error' as const,
  path: '/course/1',
  method: 'GET',
  httpStatus: 500,
  message: 'boom',
  ...over
});

describe('recordSystemEvent throttling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    resetSystemEventThrottle();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes the first api.error and suppresses identical repeats inside the window', async () => {
    for (let i = 0; i < 50; i += 1) await recordSystemEvent(apiError());

    expect(insert.insertSystemEvent).toHaveBeenCalledTimes(1);
  });

  it('a different path or status is its own bucket', async () => {
    await recordSystemEvent(apiError());
    await recordSystemEvent(apiError({ path: '/course/2' }));
    await recordSystemEvent(apiError({ httpStatus: 502 }));

    expect(insert.insertSystemEvent).toHaveBeenCalledTimes(3);
  });

  it('emits one summary row with the suppressed count when the window closes', async () => {
    for (let i = 0; i < 11; i += 1) await recordSystemEvent(apiError());
    expect(insert.insertSystemEvent).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_001);

    expect(insert.insertSystemEvent).toHaveBeenCalledTimes(2);
    const summary = insert.insertSystemEvent.mock.calls[1]?.[0] as unknown as {
      message: string;
      metadata: { suppressedCount: number };
    };
    expect(summary.metadata.suppressedCount).toBe(10);
    expect(summary.message).toContain('+10 similar suppressed');
  });

  it('after the window a new event is written again', async () => {
    await recordSystemEvent(apiError());
    await vi.advanceTimersByTimeAsync(60_001);
    await recordSystemEvent(apiError());

    expect(insert.insertSystemEvent).toHaveBeenCalledTimes(2);
  });

  it('security events are NEVER sampled (every login failure / deactivated / rate-limited row is written)', async () => {
    for (let i = 0; i < 20; i += 1) {
      await recordSystemEvent({
        eventType: 'auth.login.failure',
        severity: 'warn',
        path: '/sign-in/email',
        method: 'POST',
        httpStatus: 401,
        message: 'bad_credentials'
      });
    }

    expect(insert.insertSystemEvent).toHaveBeenCalledTimes(20);
  });

  it('SYSTEM_EVENT_THROTTLE_WINDOW_MS=0 turns throttling off', async () => {
    vi.stubEnv('SYSTEM_EVENT_THROTTLE_WINDOW_MS', '0');
    for (let i = 0; i < 5; i += 1) await recordSystemEvent(apiError());

    expect(insert.insertSystemEvent).toHaveBeenCalledTimes(5);
  });
});

// Lets the lazy `import('@cio/db')` inside recordApiError settle between requests (first call primes the module).
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('recordApiError / handleError', () => {
  const recorded = vi.hoisted(() => ({ recordSystemEvent: vi.fn(async () => undefined) }));

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.doMock('@cio/db', () => recorded);
    vi.stubEnv('VITEST', '');
  });

  afterEach(() => {
    vi.doUnmock('@cio/db');
    vi.unstubAllEnvs();
  });

  const call = async (status: number) => {
    const { recordApiError } = await import('@api/utils/record-api-error');
    const app = new Hono();
    app.get('/x', (c) => {
      recordApiError(c, new Error('x'), status, 'error');
      return c.text('ok');
    });
    await app.request('/x');
    await vi.waitFor(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 20));
  };

  it('records 5xx and 400/409 style errors', async () => {
    await call(500);
    await call(409);

    expect(recorded.recordSystemEvent).toHaveBeenCalledTimes(2);
    expect(recorded.recordSystemEvent.mock.calls[0]?.[0]).toMatchObject({ eventType: 'api.error', httpStatus: 500 });
  });

  it.each([401, 403, 404])('never records %i', async (status) => {
    await call(status);

    expect(recorded.recordSystemEvent).not.toHaveBeenCalled();
  });

  it('handleError reports a 5xx AppError and an unexpected error, but not a deliberate 4xx', async () => {
    const { handleError, AppError } = await import('@api/utils/errors');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const app = new Hono();
    app.get('/five', (c) => handleError(c, new AppError('db down', 'INTERNAL_ERROR', 500), 'Failed'));
    app.get('/unexpected', (c) => handleError(c, new Error('raw'), 'Failed'));
    app.get('/four', (c) => handleError(c, new AppError('nope', 'VALIDATION_ERROR', 400), 'Failed'));

    await app.request('/five');
    await tick();
    await app.request('/unexpected');
    await tick();
    await app.request('/four');
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(recorded.recordSystemEvent).toHaveBeenCalledTimes(2);
    expect(recorded.recordSystemEvent.mock.calls.map((c) => (c[0] as { httpStatus: number }).httpStatus)).toEqual([
      500, 500
    ]);
  });
});
