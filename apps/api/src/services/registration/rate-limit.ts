import { REGISTRATION_RATE_LIMIT } from '@cio/utils/constants';

// PearlLMS Phase 7 (docs/ONBOARDING-MODEL.md D4) — a small, always-on, per-process sliding-window limiter for
// the public registration endpoint, keyed by client IP. Config-driven (REGISTRATION_RATE_LIMIT). This is the
// deterministic, testable backstop that works in every environment (the Redis createRateLimiter is prod-only);
// it is sufficient for the single-instance droplet. Not shared across processes — fine for the closed
// single-provider deployment.

const hits = new Map<string, number[]>();

/**
 * Record a submission attempt for `ip`. Returns true if allowed, false if the per-IP window cap is exceeded.
 * `now` is injectable for tests.
 */
export function hitRegistrationRateLimit(ip: string, now: number = Date.now()): boolean {
  const { maxPerWindow, windowMs } = REGISTRATION_RATE_LIMIT;
  const key = ip || 'unknown';
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);

  if (recent.length >= maxPerWindow) {
    hits.set(key, recent); // keep the pruned window; do not record this (blocked) attempt
    return false;
  }

  recent.push(now);
  hits.set(key, recent);
  return true;
}

/** Test helper — clear all recorded windows. */
export function resetRegistrationRateLimit(): void {
  hits.clear();
}
