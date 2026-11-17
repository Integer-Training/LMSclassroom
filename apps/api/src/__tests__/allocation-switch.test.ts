import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@cio/db/actor';

// Switch tutor / bulk move (feat/switch-tutor). The DB layer is mocked so only the service decisions run:
// pre-checks (self-switch, learner role, ACTIVE incoming tutor), the 0-rows → 409 race result, the
// switched/removed_only outcome, best-effort side effects (a failing notification clear or audit never fails
// the switch), the audit shape (ids + outcome + reason, batchId for bulk) and bulk per-learner outcomes.

vi.mock('@cio/db/queries/allocation', () => ({
  createAllocation: vi.fn(),
  deleteAllocationById: vi.fn(),
  getAllocationById: vi.fn(),
  getOrgMemberRoleAndStatus: vi.fn(),
  getOrgMemberRoleId: vi.fn(),
  listAllocationsPageByOrg: vi.fn(),
  listLearnersForTutor: vi.fn(),
  moveAllocationsTx: vi.fn(),
  searchAssignablePeople: vi.fn()
}));
vi.mock('@cio/db/queries/comms', () => ({
  archiveThreadForPair: vi.fn(),
  markTutorNotificationsReadForLearners: vi.fn(async () => 0)
}));
vi.mock('@cio/db/queries/coursework', () => ({ getSubmissionStatusRowsForLearners: vi.fn(async () => []) }));
vi.mock('@cio/db/audit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@cio/db/audit')>()),
  recordAudit: vi.fn(async () => undefined)
}));
vi.mock('@cio/db/drizzle', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@cio/db/drizzle')>()),
  runInTransaction: (fn: (tx: unknown) => unknown) => fn({})
}));

import {
  getOrgMemberRoleAndStatus,
  getOrgMemberRoleId,
  listLearnersForTutor,
  moveAllocationsTx
} from '@cio/db/queries/allocation';
import { markTutorNotificationsReadForLearners } from '@cio/db/queries/comms';
import { getSubmissionStatusRowsForLearners } from '@cio/db/queries/coursework';
import { recordAudit } from '@cio/db/audit';
import {
  createTutorAllocation,
  listTutorLearnersForMove,
  moveLearnersBetweenTutors,
  switchTutorForLearner
} from '@api/services/organization/allocation';

const ORG = 'org-1';
const admin: Actor = { authenticated: true, userId: 'u-admin', role: 'ADMIN', status: 'ACTIVE', orgId: ORG };
const ROLE_TUTOR = 2;
const ROLE_STUDENT = 3;

const mMove = vi.mocked(moveAllocationsTx);
const mRoleStatus = vi.mocked(getOrgMemberRoleAndStatus);
const mRole = vi.mocked(getOrgMemberRoleId);
const mClear = vi.mocked(markTutorNotificationsReadForLearners);
const mAudit = vi.mocked(recordAudit);

const A = 'tutor-a';
const B = 'tutor-b';
const L1 = 'learner-1';
const L2 = 'learner-2';
const L3 = 'learner-3';

beforeEach(() => {
  vi.clearAllMocks();
  mRole.mockResolvedValue(ROLE_STUDENT);
  mRoleStatus.mockResolvedValue({ roleId: ROLE_TUTOR, status: 'ACTIVE' });
  mClear.mockResolvedValue(0);
  mAudit.mockResolvedValue(undefined);
});

describe('switchTutorForLearner', () => {
  const input = { learnerId: L1, fromTutorId: A, toTutorId: B };

  it('happy path: moves the learner, clears A bell items, audits ids + outcome + reason', async () => {
    mMove.mockResolvedValue({ moved: [{ learnerId: L1, allocationId: 'alloc-new' }], alreadyWithTarget: [] });
    const res = await switchTutorForLearner(ORG, admin, { ...input, reason: 'Tutor left' });

    expect(res).toEqual({ outcome: 'switched', allocationId: 'alloc-new' });
    expect(mMove).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        fromTutorId: A,
        toTutorId: B,
        learnerIds: [L1],
        createdBy: 'u-admin'
      })
    );
    expect(mClear).toHaveBeenCalledWith(A, [L1]);
    expect(mAudit).toHaveBeenCalledTimes(1);
    const audit = mAudit.mock.calls[0][0];
    expect(audit.action).toBe('allocation.switched');
    expect(audit.entityId).toBe('alloc-new');
    expect(audit.metadata).toEqual({
      learnerId: L1,
      fromTutorId: A,
      toTutorId: B,
      outcome: 'switched',
      reason: 'Tutor left'
    });
  });

  it('omits the reason key when none was given', async () => {
    mMove.mockResolvedValue({ moved: [{ learnerId: L1, allocationId: 'alloc-new' }], alreadyWithTarget: [] });
    await switchTutorForLearner(ORG, admin, input);
    expect(mAudit.mock.calls[0][0].metadata).not.toHaveProperty('reason');
  });

  it('self-switch → 400, nothing written', async () => {
    await expect(switchTutorForLearner(ORG, admin, { ...input, toTutorId: A })).rejects.toMatchObject({
      statusCode: 400
    });
    expect(mMove).not.toHaveBeenCalled();
  });

  it('learner is not a STUDENT in this org (incl. cross-org id) → 404', async () => {
    mRole.mockResolvedValue(null);
    await expect(switchTutorForLearner(ORG, admin, input)).rejects.toMatchObject({ statusCode: 404 });
    mRole.mockResolvedValue(ROLE_TUTOR);
    await expect(switchTutorForLearner(ORG, admin, input)).rejects.toMatchObject({ statusCode: 404 });
    expect(mMove).not.toHaveBeenCalled();
  });

  it('incoming tutor must be an ACTIVE TUTOR → 400 otherwise', async () => {
    mRoleStatus.mockResolvedValue({ roleId: ROLE_TUTOR, status: 'DEACTIVATED' });
    await expect(switchTutorForLearner(ORG, admin, input)).rejects.toMatchObject({ statusCode: 400 });
    mRoleStatus.mockResolvedValue({ roleId: ROLE_STUDENT, status: 'ACTIVE' });
    await expect(switchTutorForLearner(ORG, admin, input)).rejects.toMatchObject({ statusCode: 400 });
    mRoleStatus.mockResolvedValue(null);
    await expect(switchTutorForLearner(ORG, admin, input)).rejects.toMatchObject({ statusCode: 400 });
    expect(mMove).not.toHaveBeenCalled();
  });

  it('the OUTGOING tutor is not status-checked (a deactivated tutor leaving is the main case)', async () => {
    mMove.mockResolvedValue({ moved: [{ learnerId: L1, allocationId: 'alloc-new' }], alreadyWithTarget: [] });
    await switchTutorForLearner(ORG, admin, input);
    expect(mRoleStatus).toHaveBeenCalledTimes(1);
    expect(mRoleStatus).toHaveBeenCalledWith(ORG, B);
  });

  it('0 rows removed (already changed / double click) → 409, no side effects', async () => {
    mMove.mockResolvedValue({ moved: [], alreadyWithTarget: [] });
    await expect(switchTutorForLearner(ORG, admin, input)).rejects.toMatchObject({ statusCode: 409 });
    expect(mClear).not.toHaveBeenCalled();
    expect(mAudit).not.toHaveBeenCalled();
  });

  it('B was already a co-tutor → outcome removed_only, no allocation id', async () => {
    mMove.mockResolvedValue({ moved: [], alreadyWithTarget: [L1] });
    const res = await switchTutorForLearner(ORG, admin, input);
    expect(res).toEqual({ outcome: 'removed_only', allocationId: null });
    expect(mAudit.mock.calls[0][0].metadata).toMatchObject({ outcome: 'removed_only' });
  });

  it('a failing notification clear or audit does NOT fail the switch', async () => {
    mMove.mockResolvedValue({ moved: [{ learnerId: L1, allocationId: 'alloc-new' }], alreadyWithTarget: [] });
    mClear.mockRejectedValue(new Error('db down'));
    mAudit.mockRejectedValue(new Error('audit down'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(switchTutorForLearner(ORG, admin, input)).resolves.toMatchObject({ outcome: 'switched' });
    spy.mockRestore();
  });

  it('unauthenticated actor → 401', async () => {
    await expect(
      switchTutorForLearner(ORG, { authenticated: false, reason: 'anonymous' }, input)
    ).rejects.toMatchObject({
      statusCode: 401
    });
  });
});

describe('moveLearnersBetweenTutors', () => {
  it('chosen learners: per-learner outcomes + counts, one audit row each sharing a batchId', async () => {
    mMove.mockResolvedValue({ moved: [{ learnerId: L1, allocationId: 'al-1' }], alreadyWithTarget: [L2] });
    const res = await moveLearnersBetweenTutors(ORG, admin, {
      fromTutorId: A,
      toTutorId: B,
      learnerIds: [L1, L2, L3],
      reason: 'Reorg'
    });

    expect(mMove).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ learnerIds: [L1, L2, L3] }));
    expect(res.moved).toBe(1);
    expect(res.alreadyWithTarget).toBe(1);
    expect(res.notAllocated).toBe(1);
    expect(res.results).toEqual(
      expect.arrayContaining([
        { learnerId: L1, outcome: 'moved' },
        { learnerId: L2, outcome: 'alreadyWithTarget' },
        { learnerId: L3, outcome: 'notAllocated' }
      ])
    );
    // notification clear covers only the learners actually taken off A
    expect(mClear).toHaveBeenCalledTimes(1);
    expect(mClear.mock.calls[0][0]).toBe(A);
    expect([...mClear.mock.calls[0][1]].sort()).toEqual([L1, L2]);
    // one audit row per learner that left A, same batchId, reason carried
    expect(mAudit).toHaveBeenCalledTimes(2);
    const metas = mAudit.mock.calls.map((c) => c[0].metadata as Record<string, unknown>);
    expect(new Set(metas.map((m) => m.batchId)).size).toBe(1);
    expect(metas[0].batchId).toBe(res.batchId);
    expect(metas.every((m) => m.reason === 'Reorg' && m.fromTutorId === A && m.toTutorId === B)).toBe(true);
    expect(metas.map((m) => m.outcome).sort()).toEqual(['removed_only', 'switched']);
  });

  it('all: passes "all" to the tx and reports no notAllocated', async () => {
    mMove.mockResolvedValue({
      moved: [
        { learnerId: L1, allocationId: 'al-1' },
        { learnerId: L2, allocationId: 'al-2' }
      ],
      alreadyWithTarget: []
    });
    const res = await moveLearnersBetweenTutors(ORG, admin, { fromTutorId: A, toTutorId: B, all: true });
    expect(mMove).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ learnerIds: 'all' }));
    expect(res).toMatchObject({ moved: 2, alreadyWithTarget: 0, notAllocated: 0 });
  });

  it('de-duplicates the requested ids', async () => {
    mMove.mockResolvedValue({ moved: [{ learnerId: L1, allocationId: 'al-1' }], alreadyWithTarget: [] });
    await moveLearnersBetweenTutors(ORG, admin, { fromTutorId: A, toTutorId: B, learnerIds: [L1, L1] });
    expect(mMove).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ learnerIds: [L1] }));
  });

  it('same tutor → 400; inactive/non-tutor target → 400; neither writes', async () => {
    await expect(
      moveLearnersBetweenTutors(ORG, admin, { fromTutorId: A, toTutorId: A, all: true })
    ).rejects.toMatchObject({ statusCode: 400 });
    mRoleStatus.mockResolvedValue({ roleId: ROLE_TUTOR, status: 'DEACTIVATED' });
    await expect(
      moveLearnersBetweenTutors(ORG, admin, { fromTutorId: A, toTutorId: B, all: true })
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mMove).not.toHaveBeenCalled();
  });

  it('nothing to move is not an error (all with an empty caseload)', async () => {
    mMove.mockResolvedValue({ moved: [], alreadyWithTarget: [] });
    const res = await moveLearnersBetweenTutors(ORG, admin, { fromTutorId: A, toTutorId: B, all: true });
    expect(res).toMatchObject({ moved: 0, alreadyWithTarget: 0, notAllocated: 0, results: [] });
    expect(mAudit).not.toHaveBeenCalled();
  });
});

describe('createTutorAllocation — ACTIVE tutor check', () => {
  it('rejects a deactivated tutor with 400', async () => {
    mRoleStatus.mockResolvedValue({ roleId: ROLE_TUTOR, status: 'DEACTIVATED' });
    await expect(createTutorAllocation(ORG, admin, { tutorId: A, learnerId: L1 })).rejects.toMatchObject({
      statusCode: 400
    });
  });
});

describe('listTutorLearnersForMove', () => {
  it('404 when the id is not a tutor of this org', async () => {
    mRoleStatus.mockResolvedValue({ roleId: ROLE_STUDENT, status: 'ACTIVE' });
    await expect(listTutorLearnersForMove(ORG, A)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('counts only the LATEST unmarked version per (learner, unit)', async () => {
    vi.mocked(listLearnersForTutor).mockResolvedValue([
      { learnerId: L1, name: 'One', email: 'one@x.test' },
      { learnerId: L2, name: 'Two', email: null }
    ]);
    const row = (id: string, learnerId: string, lessonId: string, version: number, result: string | null) =>
      ({ id, learnerId, lessonId, version, result }) as never;
    vi.mocked(getSubmissionStatusRowsForLearners).mockResolvedValue([
      row('s1', L1, 'lesson-1', 1, null), // superseded by v2 (marked) → not awaiting
      row('s2', L1, 'lesson-1', 2, 'PASS'),
      row('s3', L1, 'lesson-2', 1, null), // awaiting
      row('s4', L1, 'lesson-3', 1, null) // awaiting
    ]);
    const res = await listTutorLearnersForMove(ORG, A);
    expect(res).toEqual([
      { learnerId: L1, name: 'One', email: 'one@x.test', awaitingMarking: 2 },
      { learnerId: L2, name: 'Two', email: null, awaitingMarking: 0 }
    ]);
  });
});
