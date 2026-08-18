import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@cio/db/actor';
import { MESSAGE_MAX_LENGTH } from '@cio/utils/constants';

// PearlLMS Phase 6 Step 4 — messaging SERVICE access matrix + text-only + message.received emit.
// docs/COMMS-MODEL.md D2 (Admin read-only oversight; Manager excluded) + D4 (pair-bound, archived read-only).

vi.mock('@cio/db/queries/allocation', () => ({
  isTutorAllocatedToLearner: vi.fn(async () => true),
  listTutorsForLearner: vi.fn(async () => [])
}));
vi.mock('@cio/db/queries/auth', () => ({
  getProfileById: vi.fn(async () => ({ fullname: 'Counterpart', email: 'c@t.test' }))
}));
vi.mock('@cio/db/queries/organization', () => ({ getOrganizationById: vi.fn(async () => ({ name: 'Org' })) }));
vi.mock('@cio/db/queries/comms', () => ({
  getThreadById: vi.fn(),
  ensureActiveThread: vi.fn(),
  insertMessage: vi.fn(async () => ({ id: 'm1', threadId: 'th1', senderId: 't1', body: 'hi', createdAt: 't' })),
  listMessages: vi.fn(async () => []),
  markThreadRead: vi.fn(async () => {})
}));
vi.mock('@api/services/comms/notify', () => ({ emitNotification: vi.fn(async () => {}) }));
vi.mock('@cio/email', () => ({ buildEmailBranding: vi.fn(() => ({})) }));
vi.mock('@cio/core/config/dashboard-url', () => ({ getAppBaseUrl: vi.fn(() => 'http://app') }));

import { isTutorAllocatedToLearner, listTutorsForLearner } from '@cio/db/queries/allocation';
import { getThreadById, ensureActiveThread, insertMessage } from '@cio/db/queries/comms';
import { emitNotification } from '@api/services/comms/notify';
import { getMyTutor, getThreadView, openThread, sendMessage } from '@api/services/comms/messaging';

const mAllocated = vi.mocked(isTutorAllocatedToLearner);
const mTutors = vi.mocked(listTutorsForLearner);
const mGetThread = vi.mocked(getThreadById);
const mEnsure = vi.mocked(ensureActiveThread);
const mInsert = vi.mocked(insertMessage);
const mEmit = vi.mocked(emitNotification);

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
    expect(await getMyTutor(learnerA)).toEqual({ tutorId: 't1', name: 'Counterpart' });
  });
  it('no allocated tutor → null (empty state)', async () => {
    mTutors.mockResolvedValue([] as never);
    expect(await getMyTutor(learnerA)).toBeNull();
  });
});
