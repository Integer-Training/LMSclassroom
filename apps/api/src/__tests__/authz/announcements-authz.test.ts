import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Actor } from '@cio/db/actor';

// PearlLMS Phase 6 Step 5 — announcement ROUTES. POST + /courses are Admin/Manager only (Tutor + Learner
// 403); reads are authed; anon 401. Service mocked.

vi.mock('@api/services/comms/announcements', () => ({
  listAnnouncements: vi.fn(async () => []),
  listAnnouncementCourses: vi.fn(async () => []),
  listCourseAnnouncements: vi.fn(async () => []),
  publishAnnouncement: vi.fn(async () => ({ id: 'an1', scope: 'provider-wide' }))
}));

import { announcementsRouter } from '@api/routes/comms/announcements';

const A = (id: string, role: string): Actor =>
  ({ authenticated: true, userId: id, role, status: 'ACTIVE', orgId: 'o1' }) as Actor;
const ACTORS: Record<string, Actor | undefined> = {
  admin: A('adm', 'ADMIN'),
  manager: A('mgr', 'MANAGER'),
  tutor: A('tut', 'TUTOR'),
  learner: A('lrn', 'LEARNER'),
  anon: undefined
};

const app = new Hono()
  .use('*', async (c, next) => {
    const actor = ACTORS[c.req.header('x-actor') ?? 'anon'];
    if (actor) c.set('actor', actor);
    await next();
  })
  .route('/announcements', announcementsRouter);

const publish = (a: string) =>
  app
    .request('/announcements', {
      method: 'POST',
      headers: { 'x-actor': a, 'content-type': 'application/json' },
      body: JSON.stringify({ courseId: null, title: 'Notice', body: 'Body' })
    })
    .then((r) => r.status);
const feed = (a: string) => app.request('/announcements', { headers: { 'x-actor': a } }).then((r) => r.status);
const courses = (a: string) =>
  app.request('/announcements/courses', { headers: { 'x-actor': a } }).then((r) => r.status);

beforeEach(() => vi.clearAllMocks());

describe('announcement routes — poster = Admin/Manager only', () => {
  it('Admin + Manager can publish (201) and load the course selector (200)', async () => {
    expect(await publish('admin')).toBe(201);
    expect(await publish('manager')).toBe(201);
    expect(await courses('admin')).toBe(200);
    expect(await courses('manager')).toBe(200);
  });
  it('Tutor is denied publish + selector (403)', async () => {
    expect(await publish('tutor')).toBe(403);
    expect(await courses('tutor')).toBe(403);
  });
  it('Learner is denied publish (403)', async () => {
    expect(await publish('learner')).toBe(403);
  });
  it('the feed is readable by any authed role; anon 401', async () => {
    expect(await feed('learner')).toBe(200);
    expect(await feed('tutor')).toBe(200);
    expect(await feed('anon')).toBe(401);
    expect(await publish('anon')).toBe(401);
  });
});
