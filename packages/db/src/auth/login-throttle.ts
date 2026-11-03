/**
 * Failure-only sign-in throttle. better-auth's built-in limiter counts every request to a path (successes
 * included), so a classroom of learners behind one public IP exhausts the budget with correct passwords. The
 * built-in rule for /sign-in/email is therefore switched off (auth.ts) and this counter takes over: only failed
 * attempts (bad credentials / blocked account) are counted per IP, successes never are. In-memory per API
 * process (the prod API is a single container); on restart the counters reset, which only loosens, never locks.
 */
type Bucket = { count: number; resetAt: number };

const MAX_BUCKETS = 50_000;

export function createLoginThrottle(opts: { max: number; windowMs: number }, now: () => number = Date.now) {
  const buckets = new Map<string, Bucket>();

  const live = (key: string): Bucket | undefined => {
    const b = buckets.get(key);
    if (b && now() >= b.resetAt) {
      buckets.delete(key);
      return undefined;
    }
    return b;
  };

  return {
    /** Seconds until the caller may retry, or null when sign-in is allowed. */
    check(key: string): number | null {
      const b = live(key);
      if (!b || b.count < opts.max) return null;
      return Math.max(1, Math.ceil((b.resetAt - now()) / 1000));
    },
    recordFailure(key: string) {
      const b = live(key);
      if (b) {
        b.count += 1;
        return;
      }
      if (buckets.size >= MAX_BUCKETS) {
        for (const [k, v] of buckets) if (now() >= v.resetAt) buckets.delete(k);
        if (buckets.size >= MAX_BUCKETS) buckets.delete(buckets.keys().next().value as string);
      }
      buckets.set(key, { count: 1, resetAt: now() + opts.windowMs });
    }
  };
}

/** Responses that count as a failed attempt: wrong credentials (401) or a blocked/unverified account (403). */
export const isLoginFailureStatus = (status: number) => status === 401 || status === 403;
