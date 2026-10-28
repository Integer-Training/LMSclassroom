import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

// Phase K (K6 code parts) — `/ready` is a monitoring-only probe (DB select 1 + Redis PING, each bounded) that answers
// 503 with the failing dependency named, and Sentry is OFF unless SENTRY_DSN and SENTRY_ENABLED=true are both set.

const deps = vi.hoisted(() => ({
  execute: vi.fn(),
  redis: { isReady: true, ping: vi.fn() }
}));
vi.mock('@cio/db/drizzle', () => ({ db: { execute: deps.execute } }));
vi.mock('@cio/core/utils/redis/redis', () => ({ redis: deps.redis }));

import { checkReadiness, readyHandler } from '@api/utils/readiness';
import { isPublicCorsPath } from '@api/middlewares/cors';
import { DEFAULT_SENTRY_TRACES_SAMPLE_RATE, resolveSentryConfig } from '@api/utils/sentry-config';

const readyApp = new Hono().get('/ready', readyHandler);

describe('GET /ready', () => {
  beforeEach(() => {
    deps.execute.mockReset().mockResolvedValue([{ '?column?': 1 }]);
    deps.redis.isReady = true;
    deps.redis.ping.mockReset().mockResolvedValue('PONG');
  });

  it('returns 200 when the database and Redis both answer', async () => {
    const res = await readyApp.request('/ready');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', service: 'api', checks: { db: 'ok', redis: 'ok' } });
    expect(deps.redis.ping).toHaveBeenCalledTimes(1);
  });

  it('returns 503 naming the database when select 1 fails, without leaking the error text', async () => {
    deps.execute.mockRejectedValue(new Error('password authentication failed for user postgres'));

    const res = await readyApp.request('/ready');
    const text = await res.text();

    expect(res.status).toBe(503);
    expect(JSON.parse(text).checks).toEqual({ db: 'fail', redis: 'ok' });
    expect(text).not.toContain('password');
  });

  it('returns 503 naming Redis when the PING fails or Redis is not ready (no PING is sent when not ready)', async () => {
    deps.redis.ping.mockRejectedValue(new Error('Connection is closed'));
    expect((await checkReadiness()).checks).toEqual({ db: 'ok', redis: 'fail' });

    deps.redis.ping.mockClear();
    deps.redis.isReady = false;
    expect((await checkReadiness()).ready).toBe(false);
    expect(deps.redis.ping).not.toHaveBeenCalled();
  });

  it('is a public path, so the session pipeline is skipped for it', () => {
    expect(isPublicCorsPath('/ready')).toBe(true);
    expect(isPublicCorsPath('/health')).toBe(true);
    expect(isPublicCorsPath('/course/ready')).toBe(false);
  });
});

describe('Sentry gating (api)', () => {
  const prod = { NODE_ENV: 'production', SENTRY_DSN: 'https://k@o.ingest.sentry.io/1' };

  it('is disabled by default, even with a DSN, until the explicit opt-in is set', () => {
    expect(resolveSentryConfig({ NODE_ENV: 'production' })).toBeNull();
    expect(resolveSentryConfig(prod)).toBeNull();
    expect(resolveSentryConfig({ ...prod, SENTRY_ENABLED: 'false' })).toBeNull();
    expect(resolveSentryConfig({ SENTRY_ENABLED: 'true', NODE_ENV: 'production' })).toBeNull();
  });

  it('never starts outside production', () => {
    expect(resolveSentryConfig({ ...prod, NODE_ENV: 'development', SENTRY_ENABLED: 'true' })).toBeNull();
  });

  it('starts with no PII and 5% traces when DSN and opt-in are both set, regardless of self-hosting', () => {
    const config = resolveSentryConfig({ ...prod, SENTRY_ENABLED: 'true', PUBLIC_IS_SELFHOSTED: 'true' });

    expect(config).toMatchObject({
      dsn: prod.SENTRY_DSN,
      sendDefaultPii: false,
      tracesSampleRate: DEFAULT_SENTRY_TRACES_SAMPLE_RATE,
      environment: 'production'
    });
    expect(DEFAULT_SENTRY_TRACES_SAMPLE_RATE).toBe(0.05);
  });

  it('honours a valid trace rate and falls back on junk or out-of-range values', () => {
    const base = { ...prod, SENTRY_ENABLED: 'true' };

    expect(resolveSentryConfig({ ...base, SENTRY_TRACES_SAMPLE_RATE: '0.2' })?.tracesSampleRate).toBe(0.2);
    expect(resolveSentryConfig({ ...base, SENTRY_TRACES_SAMPLE_RATE: '0' })?.tracesSampleRate).toBe(0);
    expect(resolveSentryConfig({ ...base, SENTRY_TRACES_SAMPLE_RATE: 'abc' })?.tracesSampleRate).toBe(0.05);
    expect(resolveSentryConfig({ ...base, SENTRY_TRACES_SAMPLE_RATE: '5' })?.tracesSampleRate).toBe(0.05);
    expect(resolveSentryConfig({ ...base, SENTRY_TRACES_SAMPLE_RATE: '' })?.tracesSampleRate).toBe(0.05);
  });
});
