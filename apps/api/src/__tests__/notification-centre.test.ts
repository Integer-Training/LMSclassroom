import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@cio/db/actor';

// PearlLMS Phase 6 Step 3 — the notification-centre SERVICE. Proves: reads/mutations use the ACTOR's own id
// (never a URL value); rows are enriched into subject + deep link by type; anon is refused. DB mocked.

vi.mock('@cio/db/queries/comms', () => ({
  listNotificationsForUser: vi.fn(async () => []),
  countUnreadNotifications: vi.fn(async () => 0),
  markNotificationRead: vi.fn(async () => 1),
  markAllNotificationsRead: vi.fn(async () => 3),
  getLessonLinkTargets: vi.fn(async () => new Map())
}));

import {
  listNotificationsForUser,
  countUnreadNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  getLessonLinkTargets
} from '@cio/db/queries/comms';
import {
  getNotificationCentre,
  markOwnNotificationRead,
  markAllOwnNotificationsRead
} from '@api/services/comms/notification-centre';

const mList = vi.mocked(listNotificationsForUser);
const mCount = vi.mocked(countUnreadNotifications);
const mMark = vi.mocked(markNotificationRead);
const mMarkAll = vi.mocked(markAllNotificationsRead);
const mLessons = vi.mocked(getLessonLinkTargets);

const learner: Actor = { authenticated: true, userId: 'learner-A', role: 'LEARNER', status: 'ACTIVE', orgId: 'o1' };
const anon: Actor = { authenticated: false } as Actor;

const row = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'n1',
  userId: 'learner-A',
  type: 'result.recorded',
  entityType: 'lesson',
  entityId: 'lesson-1',
  createdAt: '2026-08-18T10:00:00Z',
  readAt: null,
  ...over
});

async function code(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 0;
  } catch (e) {
    return (e as { statusCode?: number })?.statusCode ?? -1;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mList.mockResolvedValue([] as never);
  mCount.mockResolvedValue(0);
  mMark.mockResolvedValue(1);
  mMarkAll.mockResolvedValue(3);
  mLessons.mockResolvedValue(new Map());
});

describe('getNotificationCentre — self-scoped + enriched', () => {
  it('lists using the ACTOR own id and returns the unread count', async () => {
    mCount.mockResolvedValue(2);
    const res = await getNotificationCentre(learner);
    expect(mList).toHaveBeenCalledWith('learner-A', { limit: 30, offset: 0 });
    expect(mCount).toHaveBeenCalledWith('learner-A');
    expect(res.unreadCount).toBe(2);
  });

  it('enriches result.recorded → lesson deep link + subject', async () => {
    mList.mockResolvedValue([row()] as never);
    mLessons.mockResolvedValue(new Map([['lesson-1', { courseId: 'course-9', title: 'Session 3' }]]));
    const res = await getNotificationCentre(learner);
    expect(res.items[0]).toMatchObject({
      type: 'result.recorded',
      subject: 'Your coursework was marked — Session 3',
      link: '/courses/course-9/lessons/lesson-1',
      read: false
    });
  });

  it('submission.created → the caseload (tutor surface)', async () => {
    mList.mockResolvedValue([row({ type: 'submission.created' })] as never);
    mLessons.mockResolvedValue(new Map([['lesson-1', { courseId: 'course-9', title: 'Session 3' }]]));
    const res = await getNotificationCentre(learner);
    expect(res.items[0].link).toBe('/caseload');
  });

  it('session.unlocked → the newly-open lesson', async () => {
    mList.mockResolvedValue([row({ type: 'session.unlocked' })] as never);
    mLessons.mockResolvedValue(new Map([['lesson-1', { courseId: 'course-9', title: 'Portfolio' }]]));
    const res = await getNotificationCentre(learner);
    expect(res.items[0].link).toBe('/courses/course-9/lessons/lesson-1');
  });

  it('a read row reports read:true; a dangling lesson falls back to /lms', async () => {
    mList.mockResolvedValue([row({ readAt: '2026-08-18T11:00:00Z' })] as never);
    mLessons.mockResolvedValue(new Map()); // lesson not found
    const res = await getNotificationCentre(learner);
    expect(res.items[0].read).toBe(true);
    expect(res.items[0].link).toBe('/lms');
  });

  it('anon is refused (401)', async () => {
    expect(await code(getNotificationCentre(anon))).toBe(401);
  });
});

describe('mark read — scoped to the actor', () => {
  it('markOwnNotificationRead passes the actor own id (a foreign notification id marks nothing at the query)', async () => {
    await markOwnNotificationRead(learner, 'someones-notification-id');
    expect(mMark).toHaveBeenCalledWith('someones-notification-id', 'learner-A');
  });
  it('markAllOwnNotificationsRead scopes to the actor', async () => {
    const res = await markAllOwnNotificationsRead(learner);
    expect(mMarkAll).toHaveBeenCalledWith('learner-A');
    expect(res.marked).toBe(3);
  });
  it('anon refused on both', async () => {
    expect(await code(markOwnNotificationRead(anon, 'n1'))).toBe(401);
    expect(await code(markAllOwnNotificationsRead(anon))).toBe(401);
  });
});
