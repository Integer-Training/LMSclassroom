import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

// Phase I (hls-per-segment-full-api-stack) — a request that carries a VERIFIED asset-scoped cookie skips the session/
// Actor pipeline and the global per-user bucket (and uses its own asset+IP limiter). Anything else — no cookie, a
// forged/expired/wrong-asset cookie, OPTIONS, a non-/hls path, or the flag turned off — runs the full stack unchanged.

const limiterOptions = vi.hoisted(() => ({}) as { keyGenerator?: (c: unknown) => string; maxRequests?: number });
vi.mock('@api/middlewares/rate-limiter', () => ({
  createRateLimiter: (opts: typeof limiterOptions) => {
    Object.assign(limiterOptions, opts);
    return async (c: { header: (k: string, v: string) => void }, next: () => Promise<void>) => {
      c.header('x-hls-limiter', 'ran');
      await next();
    };
  }
}));
vi.mock('@api/utils/redis/key-generators', () => ({ extractClientIp: () => '203.0.113.9' }));
vi.mock('@api/middlewares/identity', () => ({
  setAnonymousIdentity: (c: { set: (k: string, v: unknown) => void }) => {
    c.set('user', null);
    c.set('actor', { authenticated: false });
  }
}));
vi.mock('@cio/core/services/assets/assets', () => ({
  HLS_COOKIE_NAME: 'cio_hls',
  verifyHlsToken: vi.fn(async (token: string) => {
    if (token === 'good-A') return { assetId: 'assetA', expSeconds: 9_999_999_999 };
    if (token === 'good-B') return { assetId: 'assetB', expSeconds: 9_999_999_999 };
    return null;
  })
}));

import { hlsFastPath, isHlsFastPathEnabled, skipOnHlsFastPath } from '@api/middlewares/hls-fast-path';

function makeApp() {
  const identity = vi.fn(async (_c: unknown, next: () => Promise<void>) => next());
  const globalLimiter = vi.fn(async (_c: unknown, next: () => Promise<void>) => next());
  const app = new Hono()
    .use('/hls/*', hlsFastPath())
    .use('*', skipOnHlsFastPath(identity as never))
    .use('*', skipOnHlsFastPath(globalLimiter as never))
    .all('*', (c) => c.json({ ok: true, fast: c.get('hlsFastPath' as never) === true }));
  return { app, identity, globalLimiter };
}

const req = (path: string, init: RequestInit & { cookie?: string } = {}) => {
  const { cookie, ...rest } = init;
  return new Request(`http://api.test${path}`, { ...rest, headers: cookie ? { cookie } : undefined });
};

const ORIGINAL = process.env.HLS_COOKIE_FAST_PATH;
beforeEach(() => {
  delete process.env.HLS_COOKIE_FAST_PATH;
  vi.clearAllMocks();
});
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.HLS_COOKIE_FAST_PATH;
  else process.env.HLS_COOKIE_FAST_PATH = ORIGINAL;
});

describe('HLS cookie fast path', () => {
  it('valid cookie for THIS asset: identity + global limiter are skipped, the dedicated limiter runs', async () => {
    const { app, identity, globalLimiter } = makeApp();
    const res = await app.request(req('/hls/assetA/seg-001.ts', { cookie: 'cio_hls_assetA=good-A' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, fast: true });
    expect(identity).not.toHaveBeenCalled();
    expect(globalLimiter).not.toHaveBeenCalled();
    expect(res.headers.get('x-hls-limiter')).toBe('ran');
  });

  it('HEAD also takes the fast path', async () => {
    const { app, identity } = makeApp();
    const res = await app.request(req('/hls/assetA/master.m3u8', { method: 'HEAD', cookie: 'cio_hls_assetA=good-A' }));
    expect(res.status).toBe(200);
    expect(identity).not.toHaveBeenCalled();
  });

  it('missing cookie: full path (identity + global limiter run)', async () => {
    const { app, identity, globalLimiter } = makeApp();
    const res = await app.request(req('/hls/assetA/seg-001.ts'));
    expect(await res.json()).toEqual({ ok: true, fast: false });
    expect(identity).toHaveBeenCalledTimes(1);
    expect(globalLimiter).toHaveBeenCalledTimes(1);
    expect(res.headers.get('x-hls-limiter')).toBeNull();
  });

  it('forged / expired cookie: full path', async () => {
    const { app, identity } = makeApp();
    await app.request(req('/hls/assetA/seg-001.ts', { cookie: 'cio_hls_assetA=forged' }));
    expect(identity).toHaveBeenCalledTimes(1);
  });

  it('a valid cookie for a DIFFERENT asset is not honoured: full path', async () => {
    const { app, identity } = makeApp();
    // cookie named for assetA but carrying assetB's token
    await app.request(req('/hls/assetA/seg-001.ts', { cookie: 'cio_hls_assetA=good-B' }));
    expect(identity).toHaveBeenCalledTimes(1);
    // assetB's cookie sent for an assetA URL (cookie name does not match the path asset)
    await app.request(req('/hls/assetA/seg-001.ts', { cookie: 'cio_hls_assetB=good-B' }));
    expect(identity).toHaveBeenCalledTimes(2);
  });

  it('OPTIONS preflight is never fast-pathed', async () => {
    const { app, identity } = makeApp();
    await app.request(req('/hls/assetA/seg-001.ts', { method: 'OPTIONS', cookie: 'cio_hls_assetA=good-A' }));
    expect(identity).toHaveBeenCalledTimes(1);
  });

  it('non-HLS paths are untouched even with an HLS cookie', async () => {
    const { app, identity } = makeApp();
    await app.request(req('/course/123', { cookie: 'cio_hls_assetA=good-A' }));
    expect(identity).toHaveBeenCalledTimes(1);
  });

  it('HLS_COOKIE_FAST_PATH=false rolls back to the full path', async () => {
    process.env.HLS_COOKIE_FAST_PATH = 'false';
    expect(isHlsFastPathEnabled()).toBe(false);
    const { app, identity, globalLimiter } = makeApp();
    const res = await app.request(req('/hls/assetA/seg-001.ts', { cookie: 'cio_hls_assetA=good-A' }));
    expect(await res.json()).toEqual({ ok: true, fast: false });
    expect(identity).toHaveBeenCalledTimes(1);
    expect(globalLimiter).toHaveBeenCalledTimes(1);
  });

  it('is on by default and accepts 0 / false (any case) as off', () => {
    expect(isHlsFastPathEnabled()).toBe(true);
    process.env.HLS_COOKIE_FAST_PATH = '0';
    expect(isHlsFastPathEnabled()).toBe(false);
    process.env.HLS_COOKIE_FAST_PATH = 'FALSE';
    expect(isHlsFastPathEnabled()).toBe(false);
    process.env.HLS_COOKIE_FAST_PATH = 'true';
    expect(isHlsFastPathEnabled()).toBe(true);
  });

  it('the dedicated limiter is keyed by asset + client IP and is far more generous than the 100/min user bucket', () => {
    makeApp();
    const key = limiterOptions.keyGenerator!({ req: { path: '/hls/assetA/seg-001.ts' } });
    expect(key).toBe('hls:assetA:203.0.113.9');
    expect(limiterOptions.maxRequests).toBeGreaterThan(100);
  });
});
