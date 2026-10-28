import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Actor } from '@cio/db/actor';

// PearlLMS scalability Phase C5 — courseId -> orgId binding is cached (static fact); the membership / actor decision
// is NOT: it is made per request from the fresh actor.

const mocks = vi.hoisted(() => ({ getCourseOrgId: vi.fn() }));

vi.mock('@cio/db/queries/reports', () => ({ getCourseOrgId: mocks.getCourseOrgId }));
vi.mock('@cio/db/queries/cohort', () => ({ isOrgAdminByCohortId: vi.fn() }));

import { clearCourseOrgCache, evictCourseOrgCache, requireCourseInOrg } from '@api/middlewares/guards/org-binding';

const ORG = 'org-1';
const adminOf = (orgId: string): Actor => ({
  authenticated: true,
  userId: 'u',
  role: 'ADMIN',
  status: 'ACTIVE',
  orgId
});

const app = new Hono()
  .use('*', async (c, next) => {
    const key = c.req.header('x-org') ?? 'none';
    c.set('actor' as never, (key === 'none' ? { authenticated: false, reason: 'anonymous' } : adminOf(key)) as never);
    await next();
  })
  .get('/c/:courseId', requireCourseInOrg(), (c) => c.json({ ok: true }));

const get = (courseId: string, org: string) => app.request(`/c/${courseId}`, { headers: { 'x-org': org } });

beforeEach(() => {
  clearCourseOrgCache();
  mocks.getCourseOrgId.mockReset();
  mocks.getCourseOrgId.mockResolvedValue(ORG);
  delete process.env.ORG_CACHE_TTL_MS;
  delete process.env.COURSE_ORG_CACHE_TTL_MS;
});

afterEach(() => {
  delete process.env.ORG_CACHE_TTL_MS;
  delete process.env.COURSE_ORG_CACHE_TTL_MS;
});

describe('requireCourseInOrg binding cache', () => {
  it('looks the course up once, then serves repeat requests from the cache', async () => {
    expect((await get('c1', ORG)).status).toBe(200);
    expect((await get('c1', ORG)).status).toBe(200);
    expect(mocks.getCourseOrgId).toHaveBeenCalledTimes(1);
  });

  it('still decides per request: an admin of ANOTHER org is refused even on a cache hit', async () => {
    expect((await get('c1', ORG)).status).toBe(200);
    expect((await get('c1', 'org-2')).status).toBe(404);
    expect((await get('c1', ORG)).status).toBe(200);
  });

  it('an unauthenticated / deactivated actor is refused on a cache hit (membership is never cached)', async () => {
    expect((await get('c1', ORG)).status).toBe(200);
    expect((await get('c1', 'none')).status).toBe(401);
  });

  it('does not cache a miss (unknown course) so a later-created course resolves', async () => {
    mocks.getCourseOrgId.mockResolvedValueOnce(null).mockResolvedValue(ORG);

    expect((await get('c-new', ORG)).status).toBe(404);
    expect((await get('c-new', ORG)).status).toBe(200);
    expect(mocks.getCourseOrgId).toHaveBeenCalledTimes(2);
  });

  it('evictCourseOrgCache forgets a course (course deleted)', async () => {
    await get('c1', ORG);
    evictCourseOrgCache('c1');
    await get('c1', ORG);
    expect(mocks.getCourseOrgId).toHaveBeenCalledTimes(2);
  });

  it('ORG_CACHE_TTL_MS=0 disables the cache (kill switch)', async () => {
    process.env.ORG_CACHE_TTL_MS = '0';
    await get('c1', ORG);
    await get('c1', ORG);
    expect(mocks.getCourseOrgId).toHaveBeenCalledTimes(2);
  });

  it('COURSE_ORG_CACHE_TTL_MS=0 also disables just this cache', async () => {
    process.env.COURSE_ORG_CACHE_TTL_MS = '0';
    await get('c1', ORG);
    await get('c1', ORG);
    expect(mocks.getCourseOrgId).toHaveBeenCalledTimes(2);
  });
});
