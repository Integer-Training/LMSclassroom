import {
  DEFAULT_RATE_LIMITER_OPTIONS,
  ERROR_MESSAGES,
  HTTP_STATUS,
  RATE_LIMIT_HEADERS
} from '@api/constants/rate-limiter';

import type { Context, MiddlewareHandler } from 'hono';
import { RedisRateLimiter } from '@api/utils/redis/limiter';
import { userKeyGenerator } from '../utils/redis/key-generators';
import { env } from '@cio/core/config/env';
import { logRedisUnavailableOnce, redis } from '@cio/core/utils/redis/redis';
import { withTimeout } from '@api/utils/with-timeout';

/** A rate-limit check must never hold up a request — if Redis stalls this long, fail open (allow). */
const RATE_LIMIT_CHECK_TIMEOUT_MS = 400;

/** After this many consecutive failed checks the breaker opens and Redis is skipped entirely for the cool-off. */
const RATE_LIMIT_BREAKER_FAILURES = 2;
const RATE_LIMIT_BREAKER_COOLOFF_MS = 15_000;

let consecutiveRateLimitFailures = 0;
let rateLimitBreakerOpenUntil = 0;

function isRateLimitBreakerOpen(): boolean {
  return Date.now() < rateLimitBreakerOpenUntil;
}

function recordRateLimitFailure(): void {
  consecutiveRateLimitFailures += 1;
  if (consecutiveRateLimitFailures >= RATE_LIMIT_BREAKER_FAILURES) {
    rateLimitBreakerOpenUntil = Date.now() + RATE_LIMIT_BREAKER_COOLOFF_MS;
    consecutiveRateLimitFailures = 0;
  }
}

/** Test seam: clears the circuit-breaker state. */
export function resetRateLimitBreaker(): void {
  consecutiveRateLimitFailures = 0;
  rateLimitBreakerOpenUntil = 0;
}

/** Dashboard SSR and other internal callers authenticate with PRIVATE_SERVER_KEY. */
export function isTrustedServerApiKeyRequest(c: Context): boolean {
  const expectedKey = env.PRIVATE_SERVER_KEY;
  if (!expectedKey) return false;

  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;

  return authHeader.slice('Bearer '.length).trim() === expectedKey;
}

export interface RateLimiterOptions {
  windowMs?: number;
  maxRequests?: number | ((c: any) => number);
  keyGenerator?: (c: any) => string;
  skip?: (c: any) => boolean;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
  message?: string;
  standardHeaders?: boolean;
  legacyHeaders?: boolean;
}

const defaultOptions: Required<RateLimiterOptions> = {
  ...DEFAULT_RATE_LIMITER_OPTIONS,
  keyGenerator: userKeyGenerator,
  skip: () => false
};

export const createRateLimiter = (options: RateLimiterOptions = {}): MiddlewareHandler => {
  const opts = { ...defaultOptions, ...options };

  return async (c, next) => {
    // Skip rate limiting if not in production
    if (env.NODE_ENV !== 'production' || opts.skip(c)) {
      return await next();
    }

    // Fail open without touching Redis when it is known to be down or the breaker is open, so an outage adds no
    // per-request latency. Sign-in keeps Better Auth's own throttle.
    if (!redis.isReady || isRateLimitBreakerOpen()) {
      return await next();
    }

    const maxRequests = typeof opts.maxRequests === 'function' ? opts.maxRequests(c) : opts.maxRequests;
    let result: { allowed: boolean; remaining: number; resetTime: number };

    try {
      const limiter = new RedisRateLimiter(redis, opts.windowMs, maxRequests);

      // Generate rate limit key
      const key = opts.keyGenerator(c);

      // Check rate limit (bounded — a stalled Redis command must not hold up the request; the catch fails open).
      result = await withTimeout(limiter.isAllowed(key), RATE_LIMIT_CHECK_TIMEOUT_MS, 'rate-limit check');
      consecutiveRateLimitFailures = 0;
    } catch (error) {
      recordRateLimitFailure();
      logRedisUnavailableOnce('Redis rate limiter unavailable, allowing requests without rate limiting', error);
      return await next();
    }

    // Set rate limit headers
    if (opts.standardHeaders) {
      c.header(RATE_LIMIT_HEADERS.LIMIT, maxRequests.toString());
      c.header(RATE_LIMIT_HEADERS.REMAINING, result.remaining.toString());
      c.header(RATE_LIMIT_HEADERS.RESET, new Date(result.resetTime).toISOString());
    }

    if (opts.legacyHeaders) {
      c.header(RATE_LIMIT_HEADERS.LIMIT, maxRequests.toString());
      c.header(RATE_LIMIT_HEADERS.REMAINING, result.remaining.toString());
      c.header(RATE_LIMIT_HEADERS.RESET, Math.ceil(result.resetTime / 1000).toString());
    }

    if (!result.allowed) {
      const retryAfter = Math.ceil((result.resetTime - Date.now()) / 1000);

      if (opts.standardHeaders) {
        c.header(RATE_LIMIT_HEADERS.RETRY_AFTER, retryAfter.toString());
      }

      return c.json(
        {
          error: ERROR_MESSAGES.RATE_LIMIT_EXCEEDED,
          message: opts.message,
          retryAfter
        },
        HTTP_STATUS.TOO_MANY_REQUESTS
      );
    }

    await next();
  };
};

function defaultMaxRequests(c: Context): number {
  // Org lookup runs on every SSR layout load; keep it out of the tight global bucket.
  if (c.req.method === 'GET' && c.req.path === '/organization') return 500;

  return DEFAULT_RATE_LIMITER_OPTIONS.maxRequests;
}

function shouldSkipRateLimit(c: Context): boolean {
  if (isTrustedServerApiKeyRequest(c)) return true;

  return c.req.path === '/api/auth/get-session';
}

// Default rate limiter middleware with standard configuration
export default createRateLimiter({
  maxRequests: defaultMaxRequests,
  skip: shouldSkipRateLimit
});
