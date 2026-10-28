import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';

import { HLS_COOKIE_NAME, verifyHlsToken } from '@cio/core/services/assets/assets';
import { createRateLimiter } from '@api/middlewares/rate-limiter';
import { extractClientIp } from '@api/utils/redis/key-generators';
import { setAnonymousIdentity } from '@api/middlewares/identity';

/**
 * PearlLMS scalability Phase I — HLS cookie fast path.
 *
 * Every HLS segment/playlist request used to run the whole API stack (better-auth session read + resolveActor + the
 * 100/min per-user bucket). A playing video fires a request every few seconds and a seek fires dozens, so playback
 * burned DB work and hit 429s. The `cio_hls_<assetId>` cookie is an HMAC-signed, asset-scoped, 15-minute capability
 * that the route handler already accepts on its own, so when it verifies we skip the session/Actor pipeline and the
 * global user bucket and use a separate, generous limiter keyed by asset + IP instead.
 *
 * Scope is deliberately narrow: GET/HEAD on /hls/:assetId/* with a cookie that verifies for THAT asset. A missing,
 * expired, forged or wrong-asset cookie (and OPTIONS preflights) fall through to the full path UNCHANGED, where a
 * logged-in org member is still authorised by session exactly as before. Nothing authorization-related is cached:
 * the cookie is verified (pure HMAC + expiry) on every request. Behind HLS_COOKIE_FAST_PATH (default on; set
 * `false`/`0` to roll back to the old path).
 */

const HLS_PATH = /^\/hls\/([^/]+)\/.+/;

/** Requests per minute per (asset, client IP). A busy classroom sharing one NAT IP on one video stays well under. */
const HLS_FAST_PATH_MAX_PER_MINUTE = 3000;

export function isHlsFastPathEnabled(): boolean {
  const flag = process.env.HLS_COOKIE_FAST_PATH?.trim().toLowerCase();

  return flag !== 'false' && flag !== '0';
}

const hlsLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: HLS_FAST_PATH_MAX_PER_MINUTE,
  keyGenerator: (c) => `hls:${c.req.path.split('/')[2] ?? 'unknown'}:${extractClientIp(c)}`,
  message: 'Too many video requests. Please try again shortly.'
});

/** Marks the request and applies the dedicated limiter. Mount BEFORE identityMiddleware / the global rate limiter. */
export const hlsFastPath = (): MiddlewareHandler => async (c, next) => {
  if (!isHlsFastPathEnabled()) return next();
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return next();

  const match = HLS_PATH.exec(c.req.path);
  if (!match) return next();

  const assetId = match[1];
  const token = getCookie(c, `${HLS_COOKIE_NAME}_${assetId}`);
  if (!token) return next();

  const verified = await verifyHlsToken(token);
  if (verified?.assetId !== assetId) return next();

  c.set('hlsFastPath', true);
  setAnonymousIdentity(c);

  return hlsLimiter(c, next);
};

/** Wraps a middleware (identity, the global rate limiter) so a verified HLS fast-path request skips it. */
export const skipOnHlsFastPath =
  (middleware: MiddlewareHandler): MiddlewareHandler =>
  (c, next) =>
    c.get('hlsFastPath') === true ? next() : middleware(c, next);
