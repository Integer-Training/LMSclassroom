import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Actor } from '@cio/db/actor';

// PearlLMS Phase 6 Step 6 — the preference routes are authed-self-only. Any authenticated actor reads/writes
// ONLY their own preferences: the handler passes c.get('actor') and the only path value is the category, so
// there is no user id to tamper with. Anon → 401; an unknown category → 400 (validated before the service).

vi.mock('@api/services/comms/preferences', () => ({
  getMyPreferences: vi.fn(async () => []),
  setMyPreference: vi.fn(async () => ({
    category: 'messaging',
    label: 'Messages',
    emailEnabled: false,
    isDefault: false
  }))
}));
// The router also mounts the notification-centre handlers; mock that service so loading the router does not
// pull the real @cio/db subpath (mirrors notification-centre-authz.test.ts).
vi.mock('@api/services/comms/notification-centre', () => ({
  getNotificationCentre: vi.fn(async () => ({ items: [], unreadCount: 0 })),
  markOwnNotificationRead: vi.fn(async () => ({ marked: 1 })),
  markAllOwnNotificationsRead: vi.fn(async () => ({ marked: 2 }))
}));

import { getMyPreferences, setMyPreference } from '@api/services/comms/preferences';
import { notificationsRouter } from '@api/routes/comms/notifications';

const mGet = vi.mocked(getMyPreferences);
const mSet = vi.mocked(setMyPreference);

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

const getStatus = (a: string) =>
  app.request('/notifications/preferences', { headers: { 'x-actor': a } }).then((r) => r.status);
const putStatus = (a: string, category: string) =>
  app
    .request(`/notifications/preferences/${category}`, {
      method: 'PUT',
      headers: { 'x-actor': a, 'content-type': 'application/json' },
      body: JSON.stringify({ emailEnabled: false })
    })
    .then((r) => r.status);

beforeEach(() => vi.clearAllMocks());

describe('notification preferences — authed self-only', () => {
  it('any authenticated role reads their OWN preferences (200)', async () => {
    expect(await getStatus('learnerA')).toBe(200);
    expect(await getStatus('admin')).toBe(200);
  });

  it('the read handler resolves for the REQUESTING actor, never a supplied id', async () => {
    await getStatus('learnerB');
    expect(mGet).toHaveBeenCalledTimes(1);
    expect((mGet.mock.calls[0][0] as Actor & { userId: string }).userId).toBe('learner-B');
  });

  it('a write targets the REQUESTING actor with the path category only', async () => {
    expect(await putStatus('learnerA', 'messaging')).toBe(200);
    expect(mSet).toHaveBeenCalledTimes(1);
    expect((mSet.mock.calls[0][0] as Actor & { userId: string }).userId).toBe('learner-A');
    expect(mSet.mock.calls[0][1]).toBe('messaging');
    expect(mSet.mock.calls[0][2]).toBe(false);
  });

  it('an unknown category → 400, the service is never called', async () => {
    expect(await putStatus('learnerA', 'not-a-category')).toBe(400);
    expect(mSet).not.toHaveBeenCalled();
  });

  it('anonymous is refused (401) on read and write', async () => {
    expect(await getStatus('anon')).toBe(401);
    expect(await putStatus('anon', 'messaging')).toBe(401);
  });
});
