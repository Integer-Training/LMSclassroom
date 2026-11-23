import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@cio/db/actor';

// PearlLMS Phase 6 Step 3 — the notification-centre SERVICE. Proves: reads/mutations use the ACTOR's own id
// (never a URL value); rows are enriched into subject + deep link by type; anon is refused. DB mocked.

vi.mock('@cio/db/queries/comms', () => ({
  listNotificationsForUser: vi.fn(async () => []),
  countUnreadNotifications: vi.fn(async () => 0),
  markNotificationRead: vi.fn(async () => 1),
  markAllNotificationsRead: vi.fn(async () => 3),
  getLessonLinkTargets: vi.fn(async () => new Map()),
  getThreadsByIds: vi.fn(async () => []),
  getProfileNamesByIds: vi.fn(async () => [])
}));
vi.mock('@cio/db/queries/allocation', () => ({
  listAllocatedLearnerIdsByTutors: vi.fn(async () => new Map())
}));

import {
  listNotificationsForUser,
  countUnreadNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  getLessonLinkTargets,
  getThreadsByIds,
  getProfileNamesByIds
} from '@cio/db/queries/comms';
import { listAllocatedLearnerIdsByTutors } from '@cio/db/queries/allocation';
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
const mThreads = vi.mocked(getThreadsByIds);
const mNames = vi.mocked(getProfileNamesByIds);

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

// ── Named, deep-linked notifications (in-app wording only; response shape unchanged) ─────────────────────────
describe('getNotificationCentre — names + deep links', () => {
  const tutor: Actor = { authenticated: true, userId: 'tutor-1', role: 'TUTOR', status: 'ACTIVE', orgId: 'o1' };
  const admin: Actor = { authenticated: true, userId: 'adm-1', role: 'ADMIN', status: 'ACTIVE', orgId: 'o1' };
  const LESSON = new Map([['lesson-1', { courseId: 'course-9', title: 'Unit 3' }]]);
  const sub = (over: Partial<Record<string, unknown>> = {}) =>
    row({ userId: 'tutor-1', type: 'submission.created', actorId: 'L1', variant: 'final', ...over });
  const allocated = (...ids: string[]) =>
    vi.mocked(listAllocatedLearnerIdsByTutors).mockResolvedValue(new Map([['tutor-1', ids]]));
  const names = (o: Record<string, string | null>) =>
    mNames.mockResolvedValue(Object.entries(o).map(([id, name]) => ({ id, name })));

  beforeEach(() => {
    mLessons.mockResolvedValue(LESSON);
    vi.mocked(listAllocatedLearnerIdsByTutors).mockResolvedValue(new Map());
    mThreads.mockResolvedValue([]);
    mNames.mockResolvedValue([]);
  });

  it('submission.created (final) → "<Learner> submitted <Unit> (Final)" + caseload deep link', async () => {
    mList.mockResolvedValue([sub()] as never);
    allocated('L1');
    names({ L1: 'Jane Doe' });
    const { items } = await getNotificationCentre(tutor);
    expect(items[0].subject).toBe('Jane Doe submitted Unit 3 (Final)');
    expect(items[0].link).toBe('/caseload/L1#unit-lesson-1');
    expect(Object.keys(items[0]).sort()).toEqual(['createdAt', 'id', 'link', 'read', 'subject', 'type']);
  });

  it('draft variant → (Draft); no variant → no suffix', async () => {
    mList.mockResolvedValue([sub({ variant: 'draft' }), sub({ id: 'n2', variant: null })] as never);
    allocated('L1');
    names({ L1: 'Jane Doe' });
    const { items } = await getNotificationCentre(tutor);
    expect(items[0].subject).toBe('Jane Doe submitted Unit 3 (Draft)');
    expect(items[1].subject).toBe('Jane Doe submitted Unit 3');
  });

  it('old row (no actor) → the old generic text and /caseload', async () => {
    mList.mockResolvedValue([sub({ actorId: null, variant: null })] as never);
    const { items } = await getNotificationCentre(tutor);
    expect(items[0]).toMatchObject({ subject: 'New coursework submitted — Unit 3', link: '/caseload' });
  });

  it('a learner no longer allocated to the tutor → generic text, no name, no learner link', async () => {
    mList.mockResolvedValue([sub()] as never);
    allocated('someone-else');
    names({ L1: 'Jane Doe' });
    const { items } = await getNotificationCentre(tutor);
    expect(items[0]).toMatchObject({ subject: 'New coursework submitted — Unit 3', link: '/caseload' });
    expect(JSON.stringify(items)).not.toContain('Jane');
  });

  it('Admin recipient may see any name', async () => {
    mList.mockResolvedValue([sub({ userId: 'adm-1' })] as never);
    names({ L1: 'Jane Doe' });
    const { items } = await getNotificationCentre(admin);
    expect(items[0].subject).toBe('Jane Doe submitted Unit 3 (Final)');
    expect(listAllocatedLearnerIdsByTutors).not.toHaveBeenCalled();
  });

  it('result.recorded final → "<Tutor> marked <Unit>"; draft → feedback wording; no actor → old text', async () => {
    mList.mockResolvedValue([
      row({ actorId: 'T9', variant: 'final' }),
      row({ id: 'n2', actorId: 'T9', variant: 'draft' }),
      row({ id: 'n3', actorId: null })
    ] as never);
    names({ T9: 'Tom Tutor' });
    const { items } = await getNotificationCentre(learner);
    expect(items.map((i) => i.subject)).toEqual([
      'Tom Tutor marked Unit 3',
      'Tom Tutor gave feedback on your draft — Unit 3',
      'Your coursework was marked — Unit 3'
    ]);
    expect(items[0].link).toBe('/courses/course-9/lessons/lesson-1');
  });

  it('message.received → "New message from <name>", sender derived from the thread; unknown thread → generic', async () => {
    mList.mockResolvedValue([
      row({ type: 'message.received', entityType: 'message_thread', entityId: 'th1' }),
      row({ id: 'n2', type: 'message.received', entityType: 'message_thread', entityId: 'gone' })
    ] as never);
    mThreads.mockResolvedValue([{ id: 'th1', tutorId: 'T9', learnerId: 'learner-A' }] as never);
    names({ T9: 'Tom Tutor' });
    const { items } = await getNotificationCentre(learner);
    expect(items[0]).toMatchObject({ subject: 'New message from Tom Tutor', link: '/messages/th1' });
    expect(items[1]).toMatchObject({ subject: 'New message', link: '/messages/gone' });
  });

  it('tutor recipient: a message from a learner NO LONGER allocated → "New message" (no name)', async () => {
    mList.mockResolvedValue([
      row({ userId: 'tutor-1', type: 'message.received', entityType: 'message_thread', entityId: 'thA' }),
      row({ id: 'n2', userId: 'tutor-1', type: 'message.received', entityType: 'message_thread', entityId: 'thB' })
    ] as never);
    mThreads.mockResolvedValue([
      { id: 'thA', tutorId: 'tutor-1', learnerId: 'L1' },
      { id: 'thB', tutorId: 'tutor-1', learnerId: 'L2' }
    ] as never);
    allocated('L1'); // L2 has moved to another tutor
    names({ L1: 'Lia Learner', L2: 'Moved Learner' });
    const { items } = await getNotificationCentre(tutor);
    expect(items[0]).toMatchObject({ subject: 'New message from Lia Learner', link: '/messages/thA' });
    expect(items[1]).toMatchObject({ subject: 'New message', link: '/messages/thB' });
    expect(JSON.stringify(items)).not.toContain('Moved Learner');
  });

  it('batches: one call per lookup regardless of page size (no N+1)', async () => {
    mList.mockResolvedValue([
      sub(),
      sub({ id: 'n2', actorId: 'L2' }),
      sub({ id: 'n3', actorId: 'L3' }),
      row({ id: 'n4', type: 'message.received', entityType: 'message_thread', entityId: 'th1' }),
      row({ id: 'n5', type: 'message.received', entityType: 'message_thread', entityId: 'th2' })
    ] as never);
    allocated('L1', 'L2');
    mThreads.mockResolvedValue([
      { id: 'th1', tutorId: 'tutor-1', learnerId: 'L1' },
      { id: 'th2', tutorId: 'tutor-1', learnerId: 'L2' }
    ] as never);
    names({ L1: 'A', L2: 'B', L3: 'C' });
    await getNotificationCentre(tutor);
    expect(mLessons).toHaveBeenCalledTimes(1);
    expect(mThreads).toHaveBeenCalledTimes(1);
    expect(mNames).toHaveBeenCalledTimes(1);
    expect(listAllocatedLearnerIdsByTutors).toHaveBeenCalledTimes(1);
  });
});
