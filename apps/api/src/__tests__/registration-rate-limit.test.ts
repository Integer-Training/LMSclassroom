import { beforeEach, describe, expect, it } from 'vitest';
import { REGISTRATION_RATE_LIMIT } from '@cio/utils/constants';
import { hitRegistrationRateLimit, resetRegistrationRateLimit } from '@api/services/registration/rate-limit';

// PearlLMS Phase 7 (docs/ONBOARDING-MODEL.md D4) — the per-IP registration rate limiter trips per config.

beforeEach(() => resetRegistrationRateLimit());

describe('hitRegistrationRateLimit — per-IP window cap from config', () => {
  it('allows exactly maxPerWindow, then blocks the next for the same IP', () => {
    const { maxPerWindow } = REGISTRATION_RATE_LIMIT;
    for (let i = 0; i < maxPerWindow; i++) {
      expect(hitRegistrationRateLimit('9.9.9.9')).toBe(true);
    }
    expect(hitRegistrationRateLimit('9.9.9.9')).toBe(false);
  });

  it('a different IP has its own independent budget', () => {
    const { maxPerWindow } = REGISTRATION_RATE_LIMIT;
    for (let i = 0; i < maxPerWindow; i++) hitRegistrationRateLimit('9.9.9.9');
    expect(hitRegistrationRateLimit('9.9.9.9')).toBe(false);
    expect(hitRegistrationRateLimit('8.8.8.8')).toBe(true);
  });

  it('the window slides — attempts older than windowMs no longer count', () => {
    const { maxPerWindow, windowMs } = REGISTRATION_RATE_LIMIT;
    const t0 = 1_000_000;
    for (let i = 0; i < maxPerWindow; i++) expect(hitRegistrationRateLimit('7.7.7.7', t0)).toBe(true);
    expect(hitRegistrationRateLimit('7.7.7.7', t0)).toBe(false);
    // advance past the window → budget restored
    expect(hitRegistrationRateLimit('7.7.7.7', t0 + windowMs + 1)).toBe(true);
  });
});
