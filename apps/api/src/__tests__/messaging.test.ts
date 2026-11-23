import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@cio/db/actor';
import { MESSAGE_MAX_LENGTH } from '@cio/utils/constants';

// PearlLMS Phase 6 Step 4 — messaging SERVICE access matrix + text-only + message.received emit.
// docs/COMMS-MODEL.md D2 (Admin read-only oversight; Manager excluded) + D4 (pair-bound, archived read-only).

vi.mock('@cio/db/queries/allocation', () => ({
  isTutorAllocatedToLearner: vi.fn(async () => true),
  isCourseTutorForLearner: vi.fn(async () => false),
  isCourseTutor: vi.fn(async () => false),
  listTutorsForLearner: vi.fn(async () => []),
  listLearnersForTutor: vi.fn(async () => [])
}));
vi.mock('@cio/db/queries/caseload', () => ({ getProfileStatusForIds: vi.fn(async () => new Map()) }));
vi.mock('@cio/db/queries/auth', () => ({
  getProfileById: vi.fn(async () => ({ fullname: 'Counterpart', email: 'c@t.test' }))
}));
vi.mock('@cio/db/queries/organization', () => ({ getOrganizationById: vi.fn(async () => ({ name: 'Org' })) }));
vi.mock('@cio/db/queries/comms', () => ({
  getThreadById: vi.fn(),
  ensureActiveThread: vi.fn(),
  insertMessage: vi.fn(async () => ({ id: 'm1', threadId: 'th1', senderId: 't1', body: 'hi', createdAt: 't' })),
  listMessagesPage: vi.fn(async () => ({ messages: [], hasMore: false })),
  listConversationsForParticipant: vi.fn(async () => []),
  listPreviousTutorThreads: vi.fn(async () => []),
  markThreadRead: vi.fn(async () => {}),
  markNotificationsReadForEntity: vi.fn(async () => 1),
  getProfileNamesByIds: vi.fn(async (ids: string[]) => ids.map((id) => ({ id, name: 'Counterpart' })))
}));
vi.mock('@api/services/comms/notify', () => ({ emitNotification: vi.fn(async () => {}) }));
vi.mock('@cio/email', () => ({ buildEmailBranding: vi.fn(() => ({})) }));
vi.mock('@cio/core/config/dashboard-url', () => ({ getAppBaseUrl: vi.fn(() => 'http://app') }));

import { isTutorAllocatedToLearner, listLearnersForTutor, listTutorsForLearner } from '@cio/db/queries/allocation';
import { getProfileStatusForIds } from '@cio/db/queries/caseload';
import {
  getProfileNamesByIds,
  getThreadById,
  ensureActiveThread,
  insertMessage,
  listConversationsForParticipant,
  listPreviousTutorThreads,
  listMessagesPage,
  markNotificationsReadForEntity,
  markThreadRead
} from '@cio/db/queries/comms';
import { getProfileById } from '@cio/db/queries/auth';
import { emitNotification } from '@api/services/comms/notify';
import {
  getMyLearners,
  getMyTutor,
  getMyTutors,
  getPreviousTutorThreads,
  getThreadView,
  listConversations,
  markThreadRead as markThreadReadSvc,
  openThread,
  sendMessage
} from '@api/services/comms/messaging';

const mAllocated = vi.mocked(isTutorAllocatedToLearner);
const mTutors = vi.mocked(listTutorsForLearner);
const mGetThread = vi.mocked(getThreadById);
const mEnsure = vi.mocked(ensureActiveThread);
const mInsert = vi.mocked(insertMessage);
const mEmit = vi.mocked(emitNotification);
const mPage = vi.mocked(listMessagesPage);
const mMarkRead = vi.mocked(markThreadRead);
const mClearNotif = vi.mocked(markNotificationsReadForEntity);

const A = (id: string, role: string): Actor =>
  ({ authenticated: true, userId: id, role, status: 'ACTIVE', orgId: 'o1' }) as Actor;
const tutorT1 = A('t1', 'TUTOR');
const tutorT2 = A('t2', 'TUTOR');
const learnerA = A('lA', 'LEARNER');
const learnerB = A('lB', 'LEARNER');
const admin = A('adm', 'ADMIN');
const manager = A('mgr', 'MANAGER');

const THREAD = {
  id: 'th1',
  organizationId: 'o1',
  tutorId: 't1',
  learnerId: 'lA',
  archivedAt: null as string | null,
  createdAt: 't'
};

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
  mAllocated.mockResolvedValue(true);
  mGetThread.mockResolvedValue({ ...THREAD } as never);
  mEnsure.mockResolvedValue({ ...THREAD } as never);
  mInsert.mockResolvedValue({ id: 'm1', threadId: 'th1', senderId: 't1', body: 'hi', createdAt: 't' } as never);
});

describe('openThread — allocated participant only', () => {
  it('tutor opens with their allocated learner', async () => {
    const v = await openThread(tutorT1, 'lA');
    expect(mAllocated).toHaveBeenCalledWith('t1', 'lA');
    expect(v.threadId).toBe('th1');
    expect(v.canWrite).toBe(true);
  });
  it('learner opens with their allocated tutor', async () => {
    const v = await openThread(learnerA, 't1');
    expect(mAllocated).toHaveBeenCalledWith('t1', 'lA');
    expect(v.threadId).toBe('th1');
  });
  it('a non-allocated pair → 403', async () => {
    mAllocated.mockResolvedValue(false);
    expect(await code(openThread(tutorT1, 'lB'))).toBe(403);
  });
  it('403 wording is role-specific and readable', async () => {
    mAllocated.mockResolvedValue(false);
    await expect(openThread(tutorT1, 'lB')).rejects.toThrow(
      "This learner is no longer allocated to you, so you can't message them."
    );
    await expect(openThread(learnerA, 'tX')).rejects.toThrow('This tutor is no longer allocated to you.');
  });
  it('Admin / Manager cannot open (not participants) → 403', async () => {
    expect(await code(openThread(admin, 'lA'))).toBe(403);
    expect(await code(openThread(manager, 'lA'))).toBe(403);
  });
});

describe('getThreadView — participant OR Admin (D2); Manager excluded', () => {
  it('a participant sees the thread and can write', async () => {
    const v = await getThreadView(tutorT1, 'th1');
    expect(v.canWrite).toBe(true);
    expect(v.readOnly).toBe(false);
  });
  it('Admin sees it read-only (oversight, no write)', async () => {
    const v = await getThreadView(admin, 'th1');
    expect(v.canWrite).toBe(false);
    expect(v.readOnly).toBe(true);
  });
  it('a non-participant learner (other learner) → 403', async () => {
    expect(await code(getThreadView(learnerB, 'th1'))).toBe(403);
  });
  it('a non-allocated tutor → 403', async () => {
    expect(await code(getThreadView(tutorT2, 'th1'))).toBe(403);
  });
  it('Manager → 403', async () => {
    expect(await code(getThreadView(manager, 'th1'))).toBe(403);
  });
  it('unknown thread → 404', async () => {
    mGetThread.mockResolvedValue(null as never);
    expect(await code(getThreadView(tutorT1, 'th1'))).toBe(404);
  });
  it('returns the newest page oldest-first and says whether older messages exist', async () => {
    mPage.mockResolvedValue({
      messages: [
        { id: 'm1', threadId: 'th1', senderId: 'lA', body: 'older', createdAt: '2026-01-01 10:00:00+00' },
        { id: 'm2', threadId: 'th1', senderId: 't1', body: 'newer', createdAt: '2026-01-01 11:00:00+00' }
      ],
      hasMore: true
    });
    const v = await getThreadView(tutorT1, 'th1');
    expect(v.messages.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(v.messages.map((m) => m.mine)).toEqual([false, true]);
    expect(v.hasMore).toBe(true);
  });
  it('paging back with a before cursor forwards it, and does not re-advance the read cursor', async () => {
    await getThreadView(tutorT1, 'th1', { before: '2026-01-01 10:00:00+00', limit: 50 });
    expect(mPage).toHaveBeenCalledWith('th1', { before: '2026-01-01 10:00:00+00', limit: 50 });
    expect(mMarkRead).not.toHaveBeenCalled();
  });
  it('the first page advances the participant read cursor', async () => {
    await getThreadView(tutorT1, 'th1');
    expect(mMarkRead).toHaveBeenCalledWith('th1', 't1');
  });
  it('an archived thread is read-only for its participant', async () => {
    mGetThread.mockResolvedValue({ ...THREAD, archivedAt: 't' } as never);
    const v = await getThreadView(tutorT1, 'th1');
    expect(v.archived).toBe(true);
    expect(v.canWrite).toBe(false);
    expect(v.readOnly).toBe(true);
  });
});

describe('sendMessage — participant of an active, allocated pair; text only; emits to the other party', () => {
  it('a participant sends → message written + message.received emitted to the OTHER party (coalesced)', async () => {
    const m = await sendMessage(tutorT1, 'th1', '  hello  ');
    expect(mInsert).toHaveBeenCalledWith('th1', 't1', 'hello'); // trimmed
    expect(m.mine).toBe(true);
    expect(mEmit).toHaveBeenCalledTimes(1);
    const emit = mEmit.mock.calls[0][0];
    expect(emit.type).toBe('message.received');
    expect(emit.recipients[0].userId).toBe('lA'); // the OTHER participant
    expect(emit.entityType).toBe('message_thread');
    expect(emit.entityId).toBe('th1');
    expect(emit.coalesce).toBe(true);
    expect(emit.actorId).toBe('t1'); // the sender, for the in-app wording
  });
  it('the learner sends → emits to the tutor', async () => {
    await sendMessage(learnerA, 'th1', 'hi tutor');
    expect(mEmit.mock.calls[0][0].recipients[0].userId).toBe('t1');
  });
  it('a non-participant → 403 (no message written, nothing emitted)', async () => {
    expect(await code(sendMessage(learnerB, 'th1', 'sneak'))).toBe(403);
    expect(mInsert).not.toHaveBeenCalled();
    expect(mEmit).not.toHaveBeenCalled();
  });
  it('Admin cannot write (not a participant) → 403', async () => {
    expect(await code(sendMessage(admin, 'th1', 'x'))).toBe(403);
  });
  it('an archived (read-only) thread → 403', async () => {
    mGetThread.mockResolvedValue({ ...THREAD, archivedAt: 't' } as never);
    expect(await code(sendMessage(tutorT1, 'th1', 'x'))).toBe(403);
  });
  it('a de-allocated pair → 403', async () => {
    mAllocated.mockResolvedValue(false);
    expect(await code(sendMessage(tutorT1, 'th1', 'x'))).toBe(403);
  });
  it('empty body → 400; oversized body → 400 (text-only bounds)', async () => {
    expect(await code(sendMessage(tutorT1, 'th1', '   '))).toBe(400);
    expect(await code(sendMessage(tutorT1, 'th1', 'a'.repeat(MESSAGE_MAX_LENGTH + 1)))).toBe(400);
  });
});

describe('getMyTutor — the learner entry point / empty state', () => {
  it('returns the allocated tutor', async () => {
    mTutors.mockResolvedValue([{ tutorId: 't1', email: 't1@x.test' }] as never);
    expect(await getMyTutor(learnerA)).toEqual({ tutorId: 't1', name: 'Counterpart', email: 't1@x.test' });
  });
  it('no allocated tutor → null (empty state)', async () => {
    mTutors.mockResolvedValue([] as never);
    expect(await getMyTutor(learnerA)).toBeNull();
  });
});

describe('getMyTutors — a learner with several allocated tutors', () => {
  it('lists every allocated tutor in a stable (name, id) order', async () => {
    mTutors.mockResolvedValue([
      { tutorId: 't2', email: 't2@x.test' },
      { tutorId: 't1', email: null }
    ] as never);
    const names: Record<string, string> = { t1: 'Zed', t2: 'Amy' };
    const byName = (async (ids: string[]) => ids.map((id) => ({ id, name: names[id] }))) as never;
    vi.mocked(getProfileNamesByIds).mockImplementationOnce(byName).mockImplementationOnce(byName);
    expect(await getMyTutors(learnerA)).toEqual([
      { tutorId: 't2', name: 'Amy', email: 't2@x.test' },
      { tutorId: 't1', name: 'Zed', email: null }
    ]);
    expect((await getMyTutor(learnerA))?.tutorId).toBe('t2');
  });
  it('a learner can still only open a thread with an allocated tutor', async () => {
    mAllocated.mockResolvedValue(false);
    expect(await code(openThread(learnerA, 'tOther'))).toBe(403);
  });
});

describe('reading a thread clears its bell notifications', () => {
  it('opening a thread marks the participant message_thread notifications read', async () => {
    mAllocated.mockResolvedValue(true);
    mEnsure.mockResolvedValue({ ...THREAD } as never);
    await openThread(learnerA, 't1');
    expect(mClearNotif).toHaveBeenCalledWith('lA', 'message_thread', 'th1');
  });
  it('paging back with a before cursor does not touch notifications', async () => {
    mGetThread.mockResolvedValue({ ...THREAD } as never);
    mClearNotif.mockClear();
    await getThreadView(learnerA, 'th1', { before: 'x' });
    expect(mClearNotif).not.toHaveBeenCalled();
  });
  it('a notification-clearing failure never blocks reading the thread', async () => {
    mGetThread.mockResolvedValue({ ...THREAD } as never);
    mClearNotif.mockRejectedValueOnce(new Error('db down'));
    await expect(getThreadView(learnerA, 'th1')).resolves.toBeTruthy();
  });
});

// ── Revised D4 read rule: previous tutor access ────────────────────────────────────────────────────────────
// Allocation state is modelled as a set of "tutor:learner" pairs.
function allocate(...pairs: string[]) {
  const set = new Set(pairs);
  mAllocated.mockImplementation((async (t: string, l: string) => set.has(`${t}:${l}`)) as never);
}
const ARCHIVED = { ...THREAD, archivedAt: 'ts' };
const convRow = (threadId: string, counterpartId: string, archived = false) => ({
  threadId,
  counterpartId,
  counterpartName: 'N',
  body: 'b',
  createdAt: 't',
  unread: false,
  archived
});

describe('canReadThread — former tutor loses access', () => {
  it('the thread own tutor, no longer allocated -> 403 (view and mark read)', async () => {
    allocate();
    mGetThread.mockResolvedValue({ ...ARCHIVED } as never);
    expect(await code(getThreadView(tutorT1, 'th1'))).toBe(403);
    expect(await code(markThreadReadSvc(tutorT1, 'th1'))).toBe(403);
  });
  it('inbox drops threads whose learner is no longer allocated to the tutor', async () => {
    allocate('t1:lKeep');
    vi.mocked(listConversationsForParticipant).mockResolvedValue([
      convRow('a', 'lKeep'),
      convRow('b', 'lGone', true)
    ] as never);
    expect((await listConversations(tutorT1)).map((r) => r.threadId)).toEqual(['a']);
  });
  it('a learner inbox is unfiltered (archived threads stay)', async () => {
    allocate();
    vi.mocked(listConversationsForParticipant).mockResolvedValue([convRow('a', 't1', true)] as never);
    expect(await listConversations(learnerA)).toHaveLength(1);
  });
});

describe('canReadThread — new tutor reads the predecessor thread', () => {
  it('allocated new tutor reads a removed tutor archived thread: read-only, previousTutor', async () => {
    allocate('t2:lA');
    mGetThread.mockResolvedValue({ ...ARCHIVED } as never);
    const v = await getThreadView(tutorT2, 'th1');
    expect(v.previousTutor).toBe(true);
    expect(v.canWrite).toBe(false);
    expect(v.readOnly).toBe(true);
    expect(mMarkRead).not.toHaveBeenCalled();
  });
  it('cannot send into it nor mark it read', async () => {
    allocate('t2:lA');
    mGetThread.mockResolvedValue({ ...ARCHIVED } as never);
    expect(await code(sendMessage(tutorT2, 'th1', 'x'))).toBe(403);
    expect(await code(markThreadReadSvc(tutorT2, 'th1'))).toBe(403);
  });
  it('a live co-tutor thread stays private (predecessor still allocated)', async () => {
    allocate('t1:lA', 't2:lA');
    mGetThread.mockResolvedValue({ ...ARCHIVED } as never);
    expect(await code(getThreadView(tutorT2, 'th1'))).toBe(403);
  });
  it('a non-archived thread is never readable by another tutor', async () => {
    allocate('t2:lA');
    expect(await code(getThreadView(tutorT2, 'th1'))).toBe(403);
  });
  it('a tutor not allocated to the learner -> 403', async () => {
    allocate();
    mGetThread.mockResolvedValue({ ...ARCHIVED } as never);
    expect(await code(getThreadView(tutorT2, 'th1'))).toBe(403);
  });
  it('A->B->C: C reads both predecessor threads', async () => {
    allocate('tC:lA');
    const tutorC = A('tC', 'TUTOR');
    for (const tutorId of ['t1', 't2']) {
      mGetThread.mockResolvedValue({ ...ARCHIVED, tutorId } as never);
      expect((await getThreadView(tutorC, 'th1')).previousTutor).toBe(true);
    }
  });
  it('learner and Admin are unchanged', async () => {
    allocate();
    mGetThread.mockResolvedValue({ ...ARCHIVED } as never);
    const l = await getThreadView(learnerA, 'th1');
    expect(l.previousTutor).toBe(false);
    expect(l.readOnly).toBe(true);
    const ad = await getThreadView(admin, 'th1');
    expect(ad.previousTutor).toBe(false);
    expect(ad.canWrite).toBe(false);
  });
  it('the owning tutor, still allocated, is not flagged previousTutor', async () => {
    allocate('t1:lA');
    expect((await getThreadView(tutorT1, 'th1')).previousTutor).toBe(false);
  });
});

describe('getPreviousTutorThreads', () => {
  const rows = [{ threadId: 'th9', tutorId: 't1', tutorName: 'Old Tutor', lastMessageAt: '2026-01-01' }];
  it('allocated tutor gets the list in the response shape', async () => {
    allocate('t2:lA');
    vi.mocked(listPreviousTutorThreads).mockResolvedValue(rows as never);
    expect(await getPreviousTutorThreads(tutorT2, 'lA')).toEqual([
      { threadId: 'th9', tutorName: 'Old Tutor', lastAt: '2026-01-01' }
    ]);
  });
  it('Admin allowed; unallocated tutor, learner, manager -> 403', async () => {
    allocate();
    vi.mocked(listPreviousTutorThreads).mockResolvedValue(rows as never);
    expect(await getPreviousTutorThreads(admin, 'lA')).toHaveLength(1);
    expect(await code(getPreviousTutorThreads(tutorT2, 'lA'))).toBe(403);
    expect(await code(getPreviousTutorThreads(learnerA, 'lA'))).toBe(403);
    expect(await code(getPreviousTutorThreads(manager, 'lA'))).toBe(403);
  });
});

describe('getMyLearners — the tutor "New message" picker', () => {
  const L = (learnerId: string, name: string | null, email: string | null = null) => ({ learnerId, name, email });
  it('own allocated, non-deactivated learners, sorted by name case-insensitively', async () => {
    vi.mocked(listLearnersForTutor).mockResolvedValue([
      L('l3', 'zoe', 'z@x.test'),
      L('l1', 'Bob'),
      L('l2', 'amy', 'a@x.test'),
      L('l4', 'Gone')
    ] as never);
    vi.mocked(getProfileStatusForIds).mockResolvedValue(new Map([['l4', 'DEACTIVATED']]));
    expect(await getMyLearners(tutorT1)).toEqual([
      { learnerId: 'l2', name: 'amy', email: 'a@x.test' },
      { learnerId: 'l1', name: 'Bob', email: null },
      { learnerId: 'l3', name: 'zoe', email: 'z@x.test' }
    ]);
    expect(listLearnersForTutor).toHaveBeenCalledWith('t1');
  });
  it('every non-tutor role gets [] and no query runs', async () => {
    vi.mocked(listLearnersForTutor).mockClear();
    for (const a of [learnerA, admin, manager]) expect(await getMyLearners(a)).toEqual([]);
    expect(listLearnersForTutor).not.toHaveBeenCalled();
  });
  it('anonymous → 401', async () => {
    expect(await code(getMyLearners({ authenticated: false } as Actor))).toBe(401);
  });
});

describe('counterpart.email — only for an allocated participant', () => {
  beforeEach(() => {
    vi.mocked(getProfileById).mockResolvedValue({ fullname: 'Counterpart', email: 'c@t.test' } as never);
  });
  it('participant of an allocated pair gets the email (both sides)', async () => {
    expect((await getThreadView(tutorT1, 'th1')).counterpart.email).toBe('c@t.test');
    expect((await getThreadView(learnerA, 'th1')).counterpart.email).toBe('c@t.test');
    expect((await openThread(tutorT1, 'lA')).counterpart.email).toBe('c@t.test');
  });
  it('Admin oversight → null', async () => {
    expect((await getThreadView(admin, 'th1')).counterpart.email).toBeNull();
  });
  it('a de-allocated pair (archived read-only view) → null', async () => {
    allocate();
    mGetThread.mockResolvedValue({ ...THREAD, archivedAt: 'ts' } as never);
    expect((await getThreadView(learnerA, 'th1')).counterpart.email).toBeNull();
  });
  it('a current tutor reading a predecessor thread (previousTutor) → null', async () => {
    allocate('t2:lA');
    mGetThread.mockResolvedValue({ ...THREAD, archivedAt: 'ts' } as never);
    const v = await getThreadView(tutorT2, 'th1');
    expect(v.previousTutor).toBe(true);
    expect(v.counterpart.email).toBeNull();
  });
});
