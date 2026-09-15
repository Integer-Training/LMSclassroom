import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Actor } from '@cio/db/actor';

// PearlLMS broadcasts — ROUTES. Compose/manage (publish, /courses, /tutors, /learners, archive, delete) is
// ADMIN-ONLY (Manager/Tutor/Learner 403); the feed read is authed; anon 401. Service mocked.

vi.mock('@api/services/comms/announcements', () => ({
  listAnnouncements: vi.fn(async () => []),
  listAnnouncementCourses: vi.fn(async () => []),
  listAnnouncementTutors: vi.fn(async () => []),
  listAnnouncementLearners: vi.fn(async () => []),
  listCourseAnnouncements: vi.fn(async () => []),
  publishAnnouncement: vi.fn(async () => ({ id: 'an1', audienceType: 'all_learners' })),
  archiveAnnouncement: vi.fn(async () => ({ id: 'an1', archived: true })),
  deleteAnnouncement: vi.fn(async () => ({ id: 'an1' }))
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

const ID = '11111111-1111-4111-8111-111111111111';
const publish = (a: string) =>
  app
    .request('/announcements', {
      method: 'POST',
      headers: { 'x-actor': a, 'content-type': 'application/json' },
      body: JSON.stringify({ audienceType: 'all_learners', title: 'Notice', body: 'Body' })
    })
    .then((r) => r.status);
const feed = (a: string) => app.request('/announcements', { headers: { 'x-actor': a } }).then((r) => r.status);
const courses = (a: string) =>
  app.request('/announcements/courses', { headers: { 'x-actor': a } }).then((r) => r.status);
const tutors = (a: string) => app.request('/announcements/tutors', { headers: { 'x-actor': a } }).then((r) => r.status);
const archive = (a: string) =>
  app
    .request(`/announcements/${ID}/archive`, {
      method: 'POST',
      headers: { 'x-actor': a, 'content-type': 'application/json' },
      body: JSON.stringify({ archived: true })
    })
    .then((r) => r.status);
const remove = (a: string) =>
  app.request(`/announcements/${ID}`, { method: 'DELETE', headers: { 'x-actor': a } }).then((r) => r.status);

beforeEach(() => vi.clearAllMocks());

describe('broadcast routes — admin-only compose/manage', () => {
  it('Admin can publish (201), load selectors (200), archive + delete (200)', async () => {
    expect(await publish('admin')).toBe(201);
    expect(await courses('admin')).toBe(200);
    expect(await tutors('admin')).toBe(200);
    expect(await archive('admin')).toBe(200);
    expect(await remove('admin')).toBe(200);
  });
  it('Manager is denied publish + selectors + manage (403)', async () => {
    expect(await publish('manager')).toBe(403);
    expect(await courses('manager')).toBe(403);
    expect(await tutors('manager')).toBe(403);
    expect(await archive('manager')).toBe(403);
    expect(await remove('manager')).toBe(403);
  });
  it('Tutor + Learner denied publish (403)', async () => {
    expect(await publish('tutor')).toBe(403);
    expect(await publish('learner')).toBe(403);
  });
  it('the feed is readable by any authed role; anon 401', async () => {
    expect(await feed('learner')).toBe(200);
    expect(await feed('tutor')).toBe(200);
    expect(await feed('anon')).toBe(401);
    expect(await publish('anon')).toBe(401);
  });
});
