import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Actor } from '@cio/db/actor';

// PearlLMS Phase 6 Step 3 — the notification-centre routes are authed-self-only. Any authenticated actor
// reaches ONLY their own centre (the handler passes c.get('actor'), no userId param exists); anon → 401.

vi.mock('@api/services/comms/notification-centre', () => ({
  getNotificationCentre: vi.fn(async () => ({ items: [], unreadCount: 0 })),
  markOwnNotificationRead: vi.fn(async () => ({ marked: 1 })),
  markAllOwnNotificationsRead: vi.fn(async () => ({ marked: 2 }))
}));

import { getNotificationCentre } from '@api/services/comms/notification-centre';
import { notificationsRouter } from '@api/routes/comms/notifications';

const mCentre = vi.mocked(getNotificationCentre);

const A = (id: string, role: string): Actor =>
  ({ authenticated: true, userId: id, role, status: 'ACTIVE', orgId: 'o1' }) as Actor;
const ACTORS: Record<string, Actor | undefined> = {
  learnerA: A('learner-A', 'LEARNER'),
  learnerB: A('learner-B', 'LEARNER'),
  admin: A('u-admin', 'ADMIN'),
  anon: undefined
};

const app = new Hono()
  .use('*', async (c, next) => {
    const actor = ACTORS[c.req.header('x-actor') ?? 'anon'];
    if (actor) c.set('actor', actor);
    await next();
  })
  .route('/notifications', notificationsRouter);

const NID = '11111111-1111-4111-8111-111111111111';
const listStatus = (a: string) => app.request('/notifications', { headers: { 'x-actor': a } }).then((r) => r.status);
const markStatus = (a: string) =>
  app.request(`/notifications/${NID}/read`, { method: 'POST', headers: { 'x-actor': a } }).then((r) => r.status);
const allStatus = (a: string) =>
  app.request('/notifications/read-all', { method: 'POST', headers: { 'x-actor': a } }).then((r) => r.status);

beforeEach(() => vi.clearAllMocks());

describe('notification centre — authed self-only', () => {
  it('any authenticated role gets 200 (their own centre)', async () => {
    expect(await listStatus('learnerA')).toBe(200);
    expect(await listStatus('admin')).toBe(200);
    expect(await markStatus('learnerA')).toBe(200);
    expect(await allStatus('learnerA')).toBe(200);
  });

  it('the list handler computes for the REQUESTING actor, never a supplied id', async () => {
    await listStatus('learnerB');
    // the service was called with learner-B's actor — no way to pass learner-A's id in the request
    expect(mCentre).toHaveBeenCalledTimes(1);
    expect((mCentre.mock.calls[0][0] as Actor & { userId: string }).userId).toBe('learner-B');
  });

  it('anonymous is refused (401) on list, mark, mark-all', async () => {
    expect(await listStatus('anon')).toBe(401);
    expect(await markStatus('anon')).toBe(401);
    expect(await allStatus('anon')).toBe(401);
  });
});
