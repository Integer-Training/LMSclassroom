import { isIdempotentMethod, isRetryableStatus, retryDelayMs } from './retry';

// Phase E (api-client-retries-all-methods): only GET/HEAD are repeated, and only on gateway-style failures.

describe('isIdempotentMethod', () => {
  it('treats GET / HEAD (any case, or no method) as retryable', () => {
    expect(isIdempotentMethod('GET')).toBe(true);
    expect(isIdempotentMethod('head')).toBe(true);
    expect(isIdempotentMethod(undefined)).toBe(true);
    expect(isIdempotentMethod(null)).toBe(true);
  });

  it('never retries writes', () => {
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE', 'post', 'delete']) {
      expect(isIdempotentMethod(m)).toBe(false);
    }
  });
});

describe('isRetryableStatus', () => {
  it('retries 502 / 503 / 504 only', () => {
    expect([502, 503, 504].every(isRetryableStatus)).toBe(true);
    expect([500, 501, 505, 400, 401, 404, 408, 429].some(isRetryableStatus)).toBe(false);
  });
});

describe('retryDelayMs', () => {
  it('backs off exponentially', () => {
    const mid = () => 0.5; // jitter factor 1.0
    expect(retryDelayMs(1000, 0, mid)).toBe(1000);
    expect(retryDelayMs(1000, 1, mid)).toBe(2000);
    expect(retryDelayMs(1000, 2, mid)).toBe(4000);
  });

  it('jitters within +/-25%', () => {
    expect(retryDelayMs(1000, 0, () => 0)).toBe(750);
    expect(retryDelayMs(1000, 0, () => 1)).toBe(1250);
    for (let i = 0; i < 50; i++) {
      const d = retryDelayMs(1000, 1);
      expect(d).toBeGreaterThanOrEqual(1500);
      expect(d).toBeLessThanOrEqual(2500);
    }
  });
});
