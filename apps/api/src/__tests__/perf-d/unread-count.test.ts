import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Actor } from '@cio/db/actor';

// PearlLMS scalability Phase D — GET /notifications/unread-count: the bell's count-only background poll. Self-only
// (the actor's own id, never a URL value), a single count query (no list, no lesson-link lookup), anon refused.

vi.mock('@cio/db/queries/comms', () => ({
  listNotificationsForUser: vi.fn(async () => []),
  countUnreadNotifications: vi.fn(async () => 4),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  getLessonLinkTargets: vi.fn(async () => new Map())
}));
vi.mock('@api/services/comms/preferences', () => ({ getMyPreferences: vi.fn(), setMyPreference: vi.fn() }));

import { countUnreadNotifications, getLessonLinkTargets, listNotificationsForUser } from '@cio/db/queries/comms';
import { getOwnUnreadCount } from '@api/services/comms/notification-centre';
import { notificationsRouter } from '@api/routes/comms/notifications';

const learner: Actor = { authenticated: true, userId: 'learner-A', role: 'LEARNER', status: 'ACTIVE', orgId: 'o1' };
const anon = { authenticated: false } as Actor;

const appFor = (actor: Actor) =>
  new Hono()
    .use('*', async (c, next) => {
      c.set('actor' as never, actor as never);
      await next();
    })
    .route('/notifications', notificationsRouter as unknown as Hono);

beforeEach(() => vi.clearAllMocks());

describe('getOwnUnreadCount', () => {
  it('counts the ACTOR own unread notifications only, without listing or enriching', async () => {
    await expect(getOwnUnreadCount(learner)).resolves.toEqual({ unreadCount: 4 });
    expect(countUnreadNotifications).toHaveBeenCalledWith('learner-A');
    expect(listNotificationsForUser).not.toHaveBeenCalled();
    expect(getLessonLinkTargets).not.toHaveBeenCalled();
  });

  it('refuses an anonymous actor (401)', async () => {
    await expect(getOwnUnreadCount(anon)).rejects.toMatchObject({ statusCode: 401 });
    expect(countUnreadNotifications).not.toHaveBeenCalled();
  });
});

describe('GET /notifications/unread-count', () => {
  it('returns the actor count', async () => {
    const res = await appFor(learner).request('/notifications/unread-count');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { unreadCount: 4 } });
    expect(countUnreadNotifications).toHaveBeenCalledWith('learner-A');
  });

  it('is not shadowed by the /:id/read route and refuses anonymous callers', async () => {
    const res = await appFor(anon).request('/notifications/unread-count');
    expect([401, 403]).toContain(res.status);
    expect(countUnreadNotifications).not.toHaveBeenCalled();
  });
});
