/**
 * PearlLMS Phase-10 HP/SA-4 + O3 — config-driven security rate limits (the register's confirmed values).
 *
 * These are the single source of truth for the auth + abuse-surface limits so the numbers live in code review,
 * not scattered magic literals. Login/reset are enforced by better-auth's `rateLimit.customRules`
 * (packages/db/src/auth.ts); upload + the unauth email-DoS surfaces are enforced by the api's Redis rate limiter
 * (apps/api/src/middlewares/rate-limiter.ts) — which is prod-only, so these bounds apply in production.
 *
 * Windows are seconds where a value feeds better-auth (its rateLimit API is seconds) and milliseconds where it
 * feeds the api limiter (`windowMs`). Each field documents its unit.
 */

/** Sign-in attempts per IP — O3: 10 per 15 minutes. `window` in SECONDS (better-auth). */
export const LOGIN_RATE_LIMIT = {
  window: 15 * 60,
  max: 10
} as const;

/** Password-reset requests per IP — O3: 5 per hour. `window` in SECONDS (better-auth). */
export const PASSWORD_RESET_RATE_LIMIT = {
  window: 60 * 60,
  max: 5
} as const;

/** Coursework/material uploads per user — O3: 30 per hour. `windowMs` for the api Redis limiter. */
export const UPLOAD_RATE_LIMIT = {
  windowMs: 60 * 60 * 1000,
  maxPerWindow: 30
} as const;

/**
 * Unauthenticated outbound-email surfaces (HP/D14) — the public payment-request endpoint sends emails to
 * attacker-suppliable addresses, so cap it hard per IP: 5 per hour. `windowMs` for the api Redis limiter.
 */
export const UNAUTH_EMAIL_RATE_LIMIT = {
  windowMs: 60 * 60 * 1000,
  maxPerWindow: 5
} as const;

/** Unauthenticated third-party proxy calls (HP/D14 — the public Unsplash proxy). 20 per hour per IP. */
export const UNAUTH_PROXY_RATE_LIMIT = {
  windowMs: 60 * 60 * 1000,
  maxPerWindow: 20
} as const;
