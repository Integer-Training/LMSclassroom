import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// PearlLMS scalability Phase C3 — source-level guards for the dashboard hooks (hooks.server.ts imports SvelteKit
// virtual modules, so it cannot be loaded in a unit test). Same approach as hygiene/no-leaky-logs.test.ts.

const root = path.resolve(__dirname, '../../../../..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');

describe('hooks.server.ts — session error is never a logout', () => {
  const src = read('apps/dashboard/src/hooks.server.ts');

  it('uses the tri-state session lookup', () => {
    expect(src).toMatch(/getSessionState\(event\.cookies\)/);
    expect(src).not.toMatch(/getSessionData/);
  });

  it('on error the pages handler returns the retry page BEFORE any redirect or bounce report', () => {
    const body = src.slice(src.indexOf('const handlePagesRoutes'), src.indexOf('const handleAPIRoutes'));
    const errorIdx = body.indexOf("sessionState.status === 'error'");
    expect(errorIdx).toBeGreaterThan(-1);
    expect(body.indexOf("sessionUnavailableResponse('page')")).toBeGreaterThan(errorIdx);
    expect(errorIdx).toBeLessThan(body.indexOf('reportToApi('));
    expect(errorIdx).toBeLessThan(body.indexOf('redirect('));
  });

  it('on error the API handler answers 503, not a /login redirect', () => {
    const body = src.slice(src.indexOf('const handleAPIRoutes'));
    const errorIdx = body.indexOf("sessionState.status === 'error'");
    expect(errorIdx).toBeGreaterThan(-1);
    expect(body.indexOf("sessionUnavailableResponse('api')")).toBeGreaterThan(errorIdx);
    expect(errorIdx).toBeLessThan(body.indexOf("redirect(303, '/login')"));
  });

  it('evicts the session memo when sign-in / sign-out pass through the proxy', () => {
    expect(src).toMatch(/isSessionBoundaryPath/);
    expect(src).toMatch(/forgetSession\(event\.cookies\)/);
    expect(src).toMatch(/\/api\/auth\/sign-out/);
    expect(src).toMatch(/\/api\/auth\/sign-in/);
  });
});

describe('session.ts — bounded and fail-safe', () => {
  const src = read('apps/dashboard/src/lib/utils/services/auth/session.ts');
  const core = read('apps/dashboard/src/lib/utils/services/auth/session-core.ts');

  it('passes an abort signal and has a 4s timeout', () => {
    expect(src).toMatch(/signal/);
    expect(core).toMatch(/SESSION_FETCH_TIMEOUT_MS = 4000/);
  });

  it('skips the API round trip when there is no auth cookie', () => {
    expect(src).toMatch(/!getHasCioCookies\(cookies\)/);
  });
});

describe('init.svelte.ts — auto-join only after a successful, empty membership lookup', () => {
  const src = read('apps/dashboard/src/lib/features/app/init.svelte.ts');

  it('does not treat missing orgRoles as "not a member"', () => {
    expect(src).toMatch(/this\.hasMembershipInfo\(locals\) && !this\.isMemberOfOrg/);
  });

  it('a failed pending-invite lookup (undefined) never triggers auto-join', () => {
    expect(src).toMatch(/pendingInvite === undefined/);
    expect(src).toMatch(/Promise<PendingOrgInvite \| null \| undefined>/);
  });
});

describe('better-auth cookie cache (owner decision 14)', () => {
  it('is 5 minutes and the comment no longer claims customSession refreshes with it', () => {
    const src = read('packages/db/src/auth.ts');
    expect(src).toMatch(/maxAge: 5 \* 60/);
    expect(src).not.toMatch(/Refreshes when the session cookie cache expires/);
  });

  it('customSession rethrows DB errors instead of returning empty roles + ACTIVE', () => {
    const src = read('packages/db/src/auth.ts');
    expect(src).not.toMatch(/customSession: failed to load orgRoles/);
    expect(src).toMatch(/getUserMembershipRows\(user\.id\)/);
  });
});
