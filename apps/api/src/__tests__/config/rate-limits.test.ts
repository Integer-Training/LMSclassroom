import { describe, expect, it } from 'vitest';

import {
  LOGIN_RATE_LIMIT,
  PASSWORD_RESET_RATE_LIMIT,
  UPLOAD_RATE_LIMIT,
  UNAUTH_EMAIL_RATE_LIMIT,
  UNAUTH_PROXY_RATE_LIMIT
} from '@cio/utils/constants';

// PearlLMS Phase-10 HP/SA-4 + O3 — lock the owner-confirmed rate-limit values so a future edit can't silently
// loosen them. Login/reset feed better-auth (seconds); upload + unauth surfaces feed the api limiter (ms).
describe('security rate-limit config (HP/SA-4, O3)', () => {
  it('login: 10 attempts / 15 minutes (seconds window for better-auth)', () => {
    expect(LOGIN_RATE_LIMIT).toEqual({ window: 15 * 60, max: 10 });
  });

  it('password reset: 5 / hour (seconds window for better-auth)', () => {
    expect(PASSWORD_RESET_RATE_LIMIT).toEqual({ window: 60 * 60, max: 5 });
  });

  it('upload: 30 / hour per user (ms window for the api limiter)', () => {
    expect(UPLOAD_RATE_LIMIT).toEqual({ windowMs: 60 * 60 * 1000, maxPerWindow: 30 });
  });

  it('unauth email surface (payment-request): 5 / hour per IP', () => {
    expect(UNAUTH_EMAIL_RATE_LIMIT).toEqual({ windowMs: 60 * 60 * 1000, maxPerWindow: 5 });
  });

  it('unauth proxy surface (unsplash): 20 / hour per IP', () => {
    expect(UNAUTH_PROXY_RATE_LIMIT).toEqual({ windowMs: 60 * 60 * 1000, maxPerWindow: 20 });
  });
});
