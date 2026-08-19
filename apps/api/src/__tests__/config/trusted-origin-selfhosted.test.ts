import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveTrustedBrowserOrigin } from '@cio/db/utils';

// PearlLMS Phase-10 HP/SA-3 — the ClassroomIO first-party brand wildcard (*.classroomio.com / *.myclassroomio.com)
// must NOT be trusted for CORS / Better-Auth on a self-hosted deploy: the operator does not own those domains, so
// treating any such Origin as trusted is a cross-origin (CSRF/CORS) leak. Self-hosted trusts ONLY the explicitly
// configured TRUSTED_ORIGINS + verified custom domains.

const BRAND_ORIGIN = 'https://tenant.classroomio.com';
const EXPLICIT = 'https://learn.epearlacademy.com';

describe('resolveTrustedBrowserOrigin (HP/SA-3) — brand wildcard gated off when self-hosted', () => {
  let prev: string | undefined;
  beforeEach(() => {
    prev = process.env.PUBLIC_IS_SELFHOSTED;
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.PUBLIC_IS_SELFHOSTED;
    else process.env.PUBLIC_IS_SELFHOSTED = prev;
  });

  it('self-hosted: a *.classroomio.com origin is NOT trusted (the leak that was open)', () => {
    process.env.PUBLIC_IS_SELFHOSTED = 'true';
    expect(resolveTrustedBrowserOrigin(BRAND_ORIGIN, [])).toBeUndefined();
  });

  it('self-hosted: an explicitly-configured origin IS still trusted', () => {
    process.env.PUBLIC_IS_SELFHOSTED = 'true';
    expect(resolveTrustedBrowserOrigin(EXPLICIT, [EXPLICIT])).toBe(EXPLICIT);
  });

  it('cloud (flag off): the brand wildcard is trusted (unchanged behaviour)', () => {
    process.env.PUBLIC_IS_SELFHOSTED = 'false';
    expect(resolveTrustedBrowserOrigin(BRAND_ORIGIN, [])).toBe(BRAND_ORIGIN);
  });
});
