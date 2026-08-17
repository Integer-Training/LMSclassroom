import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@cio/db/actor';

// PearlLMS Phase 3 Step 4 — coursework READ authz (the most sensitive data in the system). Proves the
// shared predicate + service wiring: SELF / allocated TUTOR / ADMIN may read; learner-B, a non-allocated
// tutor, and a Manager may NOT. DB reads are mocked so only the decision logic runs.

vi.mock('@cio/db/queries/allocation', () => ({ isTutorAllocatedToLearner: vi.fn() }));
vi.mock('@cio/db/queries/coursework', () => ({
  getSubmissionByFileKey: vi.fn(),
  getSubmissionById: vi.fn(),
  listSubmissionsWithResultForLearnerUnit: vi.fn(),
  isUnitUploadClosed: vi.fn()
}));
// Keep the real coursework service (under test) from loading the notifications → jobs → notifications-
// query resolver chain (a known vitest quirk). Email behaviour is covered in coursework-notifications.test.ts.
vi.mock('@api/services/coursework/notifications', () => ({
  notifyCourseworkSubmitted: vi.fn(),
  notifyCourseworkResulted: vi.fn(),
  courseworkEmailsEnabled: vi.fn(() => true)
}));

import { isTutorAllocatedToLearner } from '@cio/db/queries/allocation';
import {
  getSubmissionByFileKey,
  getSubmissionById,
  listSubmissionsWithResultForLearnerUnit,
  isUnitUploadClosed
} from '@cio/db/queries/coursework';
import { assertCourseworkDownloadAccess, canReadCoursework } from '@api/middlewares/guards';
import { getCourseworkSubmissionForReader, listOwnCourseworkForUnit } from '@api/services/coursework/coursework';

const mockedAllocated = vi.mocked(isTutorAllocatedToLearner);
const mockedByKey = vi.mocked(getSubmissionByFileKey);
const mockedById = vi.mocked(getSubmissionById);
const mockedListForUnit = vi.mocked(listSubmissionsWithResultForLearnerUnit);
const mockedUploadClosed = vi.mocked(isUnitUploadClosed);

const ORG = 'org-1';
const learnerA: Actor = { authenticated: true, userId: 'u-A', role: 'LEARNER', status: 'ACTIVE', orgId: ORG };
const learnerB: Actor = { authenticated: true, userId: 'u-B', role: 'LEARNER', status: 'ACTIVE', orgId: ORG };
const tutor: Actor = { authenticated: true, userId: 'u-tutor', role: 'TUTOR', status: 'ACTIVE', orgId: ORG };
const admin: Actor = { authenticated: true, userId: 'u-admin', role: 'ADMIN', status: 'ACTIVE', orgId: ORG };
const manager: Actor = { authenticated: true, userId: 'u-mgr', role: 'MANAGER', status: 'ACTIVE', orgId: ORG };
const anon: Actor = { authenticated: false, reason: 'anonymous' };

const KEY = 'coursework/c-1/u-A/l-1/1/nano-work.docx';
const SUBMISSION = {
  id: 'sub-1',
  learnerId: 'u-A',
  courseId: 'c-1',
  lessonId: 'l-1',
  version: 1,
  files: [{ key: KEY, name: 'work.docx' }],
  status: 'submitted',
  submittedAt: '2026-08-17T00:00:00Z'
};

/** Run a guard/service promise; return the AppError statusCode, or 0 when it resolved. */
async function status(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 0;
  } catch (e) {
    return (e as { statusCode?: number })?.statusCode ?? -1;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('canReadCoursework — self / allocated tutor / admin only', () => {
  it('SELF (own learnerId) → true; a different learner → false', async () => {
    expect(await canReadCoursework(learnerA, { learnerId: 'u-A' })).toBe(true);
    expect(await canReadCoursework(learnerB, { learnerId: 'u-A' })).toBe(false);
  });
  it('ADMIN → true; MANAGER → false; anon → false', async () => {
    expect(await canReadCoursework(admin, { learnerId: 'u-A' })).toBe(true);
    expect(await canReadCoursework(manager, { learnerId: 'u-A' })).toBe(false);
    expect(await canReadCoursework(anon, { learnerId: 'u-A' })).toBe(false);
  });
  it('TUTOR only when allocated to that learner', async () => {
    mockedAllocated.mockResolvedValueOnce(true);
    expect(await canReadCoursework(tutor, { learnerId: 'u-A' })).toBe(true);
    mockedAllocated.mockResolvedValueOnce(false);
    expect(await canReadCoursework(tutor, { learnerId: 'u-A' })).toBe(false);
  });
});

describe('assertCourseworkDownloadAccess — key bound to a readable submission', () => {
  it('owner (self) → allowed', async () => {
    mockedByKey.mockResolvedValue(SUBMISSION as never);
    expect(await status(assertCourseworkDownloadAccess(learnerA, [KEY]))).toBe(0);
  });
  it("another learner → 403 on the owner's key", async () => {
    mockedByKey.mockResolvedValue(SUBMISSION as never);
    expect(await status(assertCourseworkDownloadAccess(learnerB, [KEY]))).toBe(403);
  });
  it('MANAGER → 403; ADMIN → allowed', async () => {
    mockedByKey.mockResolvedValue(SUBMISSION as never);
    expect(await status(assertCourseworkDownloadAccess(manager, [KEY]))).toBe(403);
    expect(await status(assertCourseworkDownloadAccess(admin, [KEY]))).toBe(0);
  });
  it('allocated tutor → allowed; non-allocated tutor → 403', async () => {
    mockedByKey.mockResolvedValue(SUBMISSION as never);
    mockedAllocated.mockResolvedValueOnce(true);
    expect(await status(assertCourseworkDownloadAccess(tutor, [KEY]))).toBe(0);
    mockedAllocated.mockResolvedValueOnce(false);
    expect(await status(assertCourseworkDownloadAccess(tutor, [KEY]))).toBe(403);
  });
  it('a guessed / nonexistent key → 403 (never signed)', async () => {
    mockedByKey.mockResolvedValue(null);
    expect(await status(assertCourseworkDownloadAccess(learnerA, ['coursework/c-1/u-A/l-1/9/made-up.docx']))).toBe(403);
  });
  it('anon → 401', async () => {
    expect(await status(assertCourseworkDownloadAccess(anon, [KEY]))).toBe(401);
  });
});

describe('getCourseworkSubmissionForReader — detail, course/unit-bound + read-gated', () => {
  it('SELF reads own; learner-B is denied 403', async () => {
    mockedById.mockResolvedValue(SUBMISSION as never);
    expect((await getCourseworkSubmissionForReader(learnerA, 'c-1', 'l-1', 'sub-1')).id).toBe('sub-1');
    expect(await status(getCourseworkSubmissionForReader(learnerB, 'c-1', 'l-1', 'sub-1'))).toBe(403);
  });
  it('allocated tutor + Admin read; non-allocated tutor + Manager denied 403', async () => {
    mockedById.mockResolvedValue(SUBMISSION as never);
    mockedAllocated.mockResolvedValueOnce(true);
    expect((await getCourseworkSubmissionForReader(tutor, 'c-1', 'l-1', 'sub-1')).id).toBe('sub-1');
    mockedAllocated.mockResolvedValueOnce(false);
    expect(await status(getCourseworkSubmissionForReader(tutor, 'c-1', 'l-1', 'sub-1'))).toBe(403);
    expect((await getCourseworkSubmissionForReader(admin, 'c-1', 'l-1', 'sub-1')).id).toBe('sub-1');
    expect(await status(getCourseworkSubmissionForReader(manager, 'c-1', 'l-1', 'sub-1'))).toBe(403);
  });
  it('cross-course / cross-unit id pairing → 404 (never reveal it exists elsewhere)', async () => {
    mockedById.mockResolvedValue(SUBMISSION as never);
    expect(await status(getCourseworkSubmissionForReader(learnerA, 'c-2', 'l-1', 'sub-1'))).toBe(404);
    expect(await status(getCourseworkSubmissionForReader(learnerA, 'c-1', 'l-2', 'sub-1'))).toBe(404);
  });
  it('unknown submission id → 404', async () => {
    mockedById.mockResolvedValue(null);
    expect(await status(getCourseworkSubmissionForReader(learnerA, 'c-1', 'l-1', 'sub-x'))).toBe(404);
  });
});

describe('listOwnCourseworkForUnit — learner sees own result + feedback, self-scoped (Step 5)', () => {
  it("returns the caller's own submissions with result + feedback and a canSubmit flag", async () => {
    mockedListForUnit.mockResolvedValue([
      {
        id: 's2',
        learnerId: 'u-A',
        courseId: 'c-1',
        lessonId: 'l-1',
        version: 2,
        files: [],
        status: 'submitted',
        submittedAt: 't2',
        result: null,
        feedback: null
      },
      {
        id: 's1',
        learnerId: 'u-A',
        courseId: 'c-1',
        lessonId: 'l-1',
        version: 1,
        files: [],
        status: 'submitted',
        submittedAt: 't1',
        result: 'REFER',
        feedback: 'Please expand section 2'
      }
    ] as never);
    mockedUploadClosed.mockResolvedValue(false);

    const out = await listOwnCourseworkForUnit(learnerA, 'l-1');
    // Self-scoped: the query is called with the ACTOR's own id, never a supplied learner id.
    expect(mockedListForUnit).toHaveBeenCalledWith('u-A', 'l-1');
    expect(out.submissions.find((s) => s.version === 1)?.result).toBe('REFER');
    expect(out.submissions.find((s) => s.version === 1)?.feedback).toBe('Please expand section 2');
    expect(out.canSubmit).toBe(true);
  });

  it('a passed unit reports canSubmit=false (upload closed)', async () => {
    mockedListForUnit.mockResolvedValue([
      {
        id: 's1',
        learnerId: 'u-A',
        courseId: 'c-1',
        lessonId: 'l-1',
        version: 1,
        files: [],
        status: 'submitted',
        submittedAt: 't1',
        result: 'PASS',
        feedback: 'Great'
      }
    ] as never);
    mockedUploadClosed.mockResolvedValue(true);
    const out = await listOwnCourseworkForUnit(learnerA, 'l-1');
    expect(out.canSubmit).toBe(false);
  });

  it("learner B is scoped to their OWN id (never learner A's)", async () => {
    mockedListForUnit.mockResolvedValue([] as never);
    mockedUploadClosed.mockResolvedValue(false);
    await listOwnCourseworkForUnit(learnerB, 'l-1');
    expect(mockedListForUnit).toHaveBeenCalledWith('u-B', 'l-1');
  });
});
