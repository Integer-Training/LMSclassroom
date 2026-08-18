/**
 * Registration intake config (PearlLMS Phase 7). Single CONFIG source for the public registration flow — the
 * DB `registration.status` column is a plain varchar whose allowed set lives HERE (not a Postgres enum),
 * mirroring UNIT_TYPES / RESULT_VALUES / notification types. See docs/ONBOARDING-MODEL.md §3-§4.
 */

/** Registration lifecycle (one-way: pending → approved | rejected; both terminal). */
export const REGISTRATION_STATUS = ['pending', 'approved', 'rejected'] as const;

export type RegistrationStatus = (typeof REGISTRATION_STATUS)[number];

export function isAllowedRegistrationStatus(value: unknown): value is RegistrationStatus {
  return typeof value === 'string' && (REGISTRATION_STATUS as readonly string[]).includes(value);
}

/**
 * Spam controls (docs/ONBOARDING-MODEL.md D4, owner-confirmed): a hidden honeypot field + a per-IP submission
 * rate limit — no third-party CAPTCHA. A real visitor never fills the honeypot; a bot that does is silently
 * dropped (the response looks successful so the bot cannot learn it was caught).
 */
export const REGISTRATION_HONEYPOT_FIELD = 'company_website';

/** Per-client-IP submission cap: at most this many public registrations per rolling window. */
export const REGISTRATION_RATE_LIMIT = {
  maxPerWindow: 5,
  windowMs: 60 * 1000
} as const;
