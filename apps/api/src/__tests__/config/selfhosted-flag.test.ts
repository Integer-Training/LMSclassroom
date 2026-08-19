import { describe, expect, it } from 'vitest';

import { assertSelfHostedFlag } from '@api/utils/assert-selfhosted-flag';

// PearlLMS Phase-10 HP/D29 — the self-hosted flag must be EXPLICIT. An unset/typo value silently defaults every
// `=== 'true'` posture check to false → CLOUD mode → stranger-account plugins + public signup re-open on a
// closed deploy. The assertion turns that silent misconfig into a hard startup failure.
describe('assertSelfHostedFlag (HP/D29) — split-env footgun guard', () => {
  it('accepts an explicit "true" / "false"', () => {
    expect(assertSelfHostedFlag('true')).toBe('true');
    expect(assertSelfHostedFlag('false')).toBe('false');
  });

  it('throws when unset (the footgun — would have run in cloud mode)', () => {
    expect(() => assertSelfHostedFlag(undefined)).toThrow(/must be explicitly set/i);
  });

  it('throws on a typo / truthy-looking value', () => {
    expect(() => assertSelfHostedFlag('TRUE')).toThrow();
    expect(() => assertSelfHostedFlag('1')).toThrow();
    expect(() => assertSelfHostedFlag('yes')).toThrow();
    expect(() => assertSelfHostedFlag('')).toThrow();
  });
});
