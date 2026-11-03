import { describe, expect, it } from 'vitest';

// The dashboard has no runnable test runner, so its pure modules are tested from here (as perf-c does).
import {
  requireActor,
  requireAdmin,
  requireManagerOrAdmin,
  requireSameOrg,
  requireStaff
} from '../../../../dashboard/src/lib/server/guards';
import { safeRedirectPath } from '../../../../dashboard/src/lib/utils/functions/routes/safeRedirect';
import { isStaleChunkError } from '../../../../dashboard/src/lib/utils/functions/stale-chunk-reload';

const locals = (role: string) => ({
  actor: { authenticated: true, role, userId: 'u1', orgId: 'org-1' } as never
});

function thrown(fn: () => unknown) {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return undefined;
}

const TO_HOME = { status: 303, location: '/' };

describe('wrong-role pages send the user to their own home instead of an error page', () => {
  it('a learner opening an admin page (e.g. /org/{slug}/learners) is redirected to / (then /lms)', () => {
    expect(thrown(() => requireAdmin(locals('STUDENT')))).toMatchObject(TO_HOME);
  });

  it('tutors and managers on admin pages, learners on staff and manager pages: same redirect', () => {
    expect(thrown(() => requireAdmin(locals('TUTOR')))).toMatchObject(TO_HOME);
    expect(thrown(() => requireAdmin(locals('MANAGER')))).toMatchObject(TO_HOME);
    expect(thrown(() => requireStaff(locals('STUDENT')))).toMatchObject(TO_HOME);
    expect(thrown(() => requireManagerOrAdmin(locals('STUDENT')))).toMatchObject(TO_HOME);
  });

  it('allowed roles pass and each role home passes its own guard (no redirect loop)', () => {
    expect(thrown(() => requireAdmin(locals('ADMIN')))).toBeUndefined();
    expect(thrown(() => requireStaff(locals('TUTOR')))).toBeUndefined(); // /caseload
    expect(thrown(() => requireManagerOrAdmin(locals('MANAGER')))).toBeUndefined(); // /reports
    expect(thrown(() => requireActor(locals('STUDENT')))).toBeUndefined(); // /lms
  });

  it('signed out still goes to /login; a different organisation is still refused', () => {
    expect(thrown(() => requireAdmin({}))).toMatchObject({ status: 303, location: '/login' });
    expect(thrown(() => requireSameOrg(locals('ADMIN'), 'org-2'))).toMatchObject({ status: 403 });
  });
});

describe('post-login ?redirect= stays on this site', () => {
  it.each([
    ['/org/lmsctest/learners', '/org/lmsctest/learners'],
    ['/courses/c1/lessons?next=true', '/courses/c1/lessons?next=true'],
    ['/', '/']
  ])('keeps the same-site path %s', (input, expected) => {
    expect(safeRedirectPath(input)).toBe(expected);
  });

  it.each([null, undefined, '', 'https://evil.example/x', '//evil.example', '/\\evil.example', 'javascript:alert(1)'])(
    'falls back to / for %s',
    (input) => {
      expect(safeRedirectPath(input)).toBe('/');
    }
  );
});

describe('stale build detection', () => {
  it('recognises the browsers’ missing-code-file errors', () => {
    expect(
      isStaleChunkError(
        new TypeError(
          'Failed to fetch dynamically imported module: https://learn.epearlacademy.com/_app/immutable/nodes/59.B94P-L19.js'
        )
      )
    ).toBe(true);
    expect(isStaleChunkError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isStaleChunkError({ message: 'error loading dynamically imported module' })).toBe(true);
  });

  it('ignores ordinary errors', () => {
    expect(isStaleChunkError(new Error('navigation aborted'))).toBe(false);
    expect(isStaleChunkError(null)).toBe(false);
  });
});
