import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Actor } from '@cio/db/actor';
import type { AuthSession } from '@api/types/auth';

// Real-router wiring proof for the FLAGGED marking area. We mount the ACTUAL mark router and drive
// it with an injected fixture Actor, asserting the guard DECISION. Heavy service/DB/core modules
// are mocked so only the guard chain runs. This asserts the CLOSED (post-implementation) state:
//  - before the mark.ts edit these are RED (courseMemberMiddleware lets an enrolled learner pull the
//    whole gradebook — the ACCESS.md "gradebook allows students" gap);
//  - after the edit (requireMarkingAccess) they are GREEN.
//
// (course/people escalation and cross-org gaps are proven by guard-layer.test.ts + the coverage
// sweep; people.ts can't be imported under vitest because it pulls the 3-level @cio/utils subpath
// `validation/course/people`, which the vite resolver can't load — a pre-existing packaging quirk.)

vi.mock('@cio/db/queries/group', () => ({
  isUserCourseMemberOrOrgAdmin: vi.fn(async () => true), // an enrolled learner IS a course member
  isCourseTeamMemberOrOrgAdmin: vi.fn(async () => true),
  getUserCourseRole: vi.fn(async () => 3)
}));
vi.mock('@cio/core/services/course/course', () => ({
  ensureProgramCourseAccess: vi.fn(async () => false)
}));
vi.mock('@api/services/mark/gradebook', () => ({ getGradebook: vi.fn(async () => []) }));
vi.mock('@api/services/mark', () => ({ getMarks: vi.fn(async () => []) }));

import { markRouter } from '@api/routes/course/mark';

const ORG = 'org-1';
const ACTORS: Record<string, Actor> = {
  learner: { authenticated: true, userId: 'u-learner', role: 'LEARNER', status: 'ACTIVE', orgId: ORG },
  tutor: { authenticated: true, userId: 'u-tutor', role: 'TUTOR', status: 'ACTIVE', orgId: ORG },
  admin: { authenticated: true, userId: 'u-admin', role: 'ADMIN', status: 'ACTIVE', orgId: ORG }
};

const app = new Hono<AuthSession>()
  .use('*', async (c, next) => {
    const key = c.req.header('x-test-actor') ?? 'learner';
    // The mark router's guard (requireMarkingAccess) consults ONLY the resolved actor.
    c.set('actor', ACTORS[key]);
    await next();
  })
  .route('/course/:courseId/mark', markRouter as unknown as Hono);

const get = (path: string, actor: string) => app.request(path, { headers: { 'x-test-actor': actor } });

describe('mark/gradebook — students must not pull the whole class (ACCESS.md gradebook gap)', () => {
  it('LEARNER → GET /mark/gradebook = 403', async () => {
    expect((await get('/course/c-1/mark/gradebook', 'learner')).status).toBe(403);
  });
  it('LEARNER → GET /mark = 403', async () => {
    expect((await get('/course/c-1/mark', 'learner')).status).toBe(403);
  });
  it('TUTOR → GET /mark/gradebook = 403 (no allocation in Phase 1)', async () => {
    expect((await get('/course/c-1/mark/gradebook', 'tutor')).status).toBe(403);
  });
  it('ADMIN → GET /mark/gradebook = 200', async () => {
    expect((await get('/course/c-1/mark/gradebook', 'admin')).status).toBe(200);
  });
  it('ADMIN → GET /mark = 200', async () => {
    expect((await get('/course/c-1/mark', 'admin')).status).toBe(200);
  });
});
