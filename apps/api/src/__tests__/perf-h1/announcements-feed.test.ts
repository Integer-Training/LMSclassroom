import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Actor } from '@cio/db/actor';
import type { AuthSession } from '@api/types/auth';

// Phase H1 — GET /announcements defaults to the unarchived feed (newest 20, applied in the service); the admin manage
// page opts in with ?includeArchived=true; bad paging params are rejected before the service runs. No email path is
// touched (announcements stay in-app only).

vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
  process.env.PRIVATE_DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
});

vi.mock('@api/services/comms/announcements', () => ({
  archiveAnnouncement: vi.fn(),
  deleteAnnouncement: vi.fn(),
  listAnnouncementCourses: vi.fn(),
  listAnnouncementLearners: vi.fn(),
  listAnnouncements: vi.fn(async () => []),
  listAnnouncementTutors: vi.fn(),
  listCourseAnnouncements: vi.fn(),
  publishAnnouncement: vi.fn()
}));

import { listAnnouncements } from '@api/services/comms/announcements';
import { announcementsRouter } from '@api/routes/comms/announcements';

const admin: Actor = { authenticated: true, userId: 'a', role: 'ADMIN', status: 'ACTIVE', orgId: 'o1' };
const app = new Hono<AuthSession>()
  .use('*', async (c, next) => {
    c.set('actor', admin);
    await next();
  })
  .route('/announcements', announcementsRouter as unknown as Hono);

beforeEach(() => vi.clearAllMocks());

describe('GET /announcements paging params', () => {
  it('no query -> default feed (includeArchived false, service default limit)', async () => {
    expect((await app.request('/announcements')).status).toBe(200);
    expect(listAnnouncements).toHaveBeenCalledWith(admin, { includeArchived: false, limit: undefined });
  });

  it('?includeArchived=true&limit=50 reaches the service', async () => {
    expect((await app.request('/announcements?includeArchived=true&limit=50')).status).toBe(200);
    expect(listAnnouncements).toHaveBeenCalledWith(admin, { includeArchived: true, limit: 50 });
  });

  it('rejects a junk includeArchived and an out-of-range limit', async () => {
    expect((await app.request('/announcements?includeArchived=maybe')).status).toBe(400);
    expect((await app.request('/announcements?limit=0')).status).toBe(400);
    expect((await app.request('/announcements?limit=500')).status).toBe(400);
    expect(listAnnouncements).not.toHaveBeenCalled();
  });
});
