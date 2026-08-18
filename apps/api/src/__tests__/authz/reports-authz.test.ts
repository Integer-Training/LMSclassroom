import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Actor } from '@cio/db/actor';

// PearlLMS Phase 5 Step 4 — the provider-wide report is Manager/Admin ONLY. Tutor and Learner are denied on
// every route; anonymous is 401. The service is mocked so only the guard is exercised.

vi.mock('@api/services/reports/progress-report', () => ({
  listOrgReportableCourses: vi.fn(async () => []),
  getProviderProgressReport: vi.fn(async () => ({ courseId: 'c1', rows: [] }))
}));

import { reportsRouter } from '@api/routes/reports/reports';

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
  .route('/reports', reportsRouter);

const COURSE_UUID = '11111111-1111-4111-8111-111111111111';
const coursesStatus = (actor: string) =>
  app.request('/reports/progress/courses', { headers: { 'x-actor': actor } }).then((r) => r.status);
const reportStatus = (actor: string) =>
  app.request(`/reports/progress?courseId=${COURSE_UUID}`, { headers: { 'x-actor': actor } }).then((r) => r.status);

beforeEach(() => vi.clearAllMocks());

describe('reports — Manager/Admin only', () => {
  it('Manager and Admin are allowed (200) on both routes', async () => {
    expect(await coursesStatus('manager')).toBe(200);
    expect(await coursesStatus('admin')).toBe(200);
    expect(await reportStatus('manager')).toBe(200);
    expect(await reportStatus('admin')).toBe(200);
  });

  it('Tutor is denied (403) on both routes', async () => {
    expect(await coursesStatus('tutor')).toBe(403);
    expect(await reportStatus('tutor')).toBe(403);
  });

  it('Learner is denied (403) on both routes', async () => {
    expect(await coursesStatus('learner')).toBe(403);
    expect(await reportStatus('learner')).toBe(403);
  });

  it('Anonymous is unauthorized (401)', async () => {
    expect(await coursesStatus('anon')).toBe(401);
    expect(await reportStatus('anon')).toBe(401);
  });
});
