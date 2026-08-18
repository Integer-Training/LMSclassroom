import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Actor } from '@cio/db/actor';

// PearlLMS Phase 5 Step 5 — lite onboarding is ADMIN ONLY. Manager, Tutor and Learner are denied on both the
// onboarding routes; anonymous is 401. The service is mocked so only the guard is exercised.

vi.mock('@api/services/onboarding/onboarding', () => ({
  listOnboardingCourses: vi.fn(async () => []),
  onboardLearner: vi.fn(async () => ({ userId: 'u1', courseId: 'c1', courseTitle: 'iCQ', learnerName: 'New' }))
}));
// The users router imports these too; keep them inert so importing the router never touches Better Auth/DB.
vi.mock('@api/services/organization/users', () => ({
  createOrgUser: vi.fn(),
  changeOrgUserRole: vi.fn(),
  changeOrgUserStatus: vi.fn(),
  getLearnerProfile: vi.fn(),
  listOrgUsers: vi.fn(),
  updateLearnerProfile: vi.fn()
}));

import { usersRouter } from '@api/routes/organization/users';

const ORG = 'org-1';
const A = (id: string, role: string): Actor =>
  ({ authenticated: true, userId: id, role, status: 'ACTIVE', orgId: ORG }) as Actor;
const ACTORS: Record<string, Actor | undefined> = {
  admin: A('u-admin', 'ADMIN'),
  manager: A('u-mgr', 'MANAGER'),
  tutor: A('u-tutor', 'TUTOR'),
  learner: A('u-learner', 'LEARNER'),
  anon: undefined
};

const app = new Hono()
  .use('*', async (c, next) => {
    const actor = ACTORS[c.req.header('x-actor') ?? 'anon'];
    if (actor) c.set('actor', actor);
    await next();
  })
  .route('/users', usersRouter);

const COURSE = '11111111-1111-4111-8111-111111111111';
const coursesStatus = (actor: string) =>
  app.request('/users/onboard/courses', { headers: { 'x-actor': actor } }).then((r) => r.status);
const onboardStatus = (actor: string) =>
  app
    .request('/users/onboard', {
      method: 'POST',
      headers: { 'x-actor': actor, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'New Learner', email: 'new@example.com', courseId: COURSE })
    })
    .then((r) => r.status);

beforeEach(() => vi.clearAllMocks());

describe('onboarding — Admin only', () => {
  it('Admin is allowed (200 list, 201 onboard)', async () => {
    expect(await coursesStatus('admin')).toBe(200);
    expect(await onboardStatus('admin')).toBe(201);
  });

  it('Manager is denied (403) on both routes', async () => {
    expect(await coursesStatus('manager')).toBe(403);
    expect(await onboardStatus('manager')).toBe(403);
  });

  it('Tutor is denied (403) on both routes', async () => {
    expect(await coursesStatus('tutor')).toBe(403);
    expect(await onboardStatus('tutor')).toBe(403);
  });

  it('Learner is denied (403) on both routes', async () => {
    expect(await coursesStatus('learner')).toBe(403);
    expect(await onboardStatus('learner')).toBe(403);
  });

  it('Anonymous is unauthorized (401)', async () => {
    expect(await coursesStatus('anon')).toBe(401);
    expect(await onboardStatus('anon')).toBe(401);
  });
});
