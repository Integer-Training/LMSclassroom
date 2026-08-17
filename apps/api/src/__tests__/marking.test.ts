import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@cio/db/actor';
import { isPassingResult, RESULT_VALUES } from '@cio/utils/constants';

// PearlLMS Phase 3 Step 5 — marking record (TEST-FIRST). Covers the passed-helper truth table (via the
// config decision + latest-marked value), the recordResult state machine (mark, latest-only, no re-mark),
// access (allocated tutor / Admin only), and the audit row (id + version + result — NEVER feedback).
// DB reads are mocked so only the decision logic runs; the SQL ordering of getLatestMarkedResult is
// proven separately in the live E2E.

vi.mock('@cio/db/queries/coursework', () => ({
  getSubmissionById: vi.fn(),
  getResultForSubmission: vi.fn(),
  getLatestSubmissionResultState: vi.fn(),
  recordCourseworkResult: vi.fn(),
  getSubmissionByFileKey: vi.fn() // pulled in by the guard module import chain
}));
vi.mock('@cio/db/queries/allocation', () => ({ isTutorAllocatedToLearner: vi.fn() }));
vi.mock('@cio/db/audit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@cio/db/audit')>()),
  recordAudit: vi.fn()
}));

import {
  getSubmissionById,
  getResultForSubmission,
  getLatestSubmissionResultState,
  recordCourseworkResult
} from '@cio/db/queries/coursework';
import { isTutorAllocatedToLearner } from '@cio/db/queries/allocation';
import { recordAudit } from '@cio/db/audit';
import { recordResult } from '@api/services/coursework/marking';

const mById = vi.mocked(getSubmissionById);
const mResult = vi.mocked(getResultForSubmission);
const mLatest = vi.mocked(getLatestSubmissionResultState);
const mRecord = vi.mocked(recordCourseworkResult);
const mAllocated = vi.mocked(isTutorAllocatedToLearner);
const mAudit = vi.mocked(recordAudit);

const ORG = 'org-1';
const tutor: Actor = { authenticated: true, userId: 'u-tutor', role: 'TUTOR', status: 'ACTIVE', orgId: ORG };
const tutorOther: Actor = { authenticated: true, userId: 'u-tutor2', role: 'TUTOR', status: 'ACTIVE', orgId: ORG };
const admin: Actor = { authenticated: true, userId: 'u-admin', role: 'ADMIN', status: 'ACTIVE', orgId: ORG };
const manager: Actor = { authenticated: true, userId: 'u-mgr', role: 'MANAGER', status: 'ACTIVE', orgId: ORG };
const learner: Actor = { authenticated: true, userId: 'u-L1', role: 'LEARNER', status: 'ACTIVE', orgId: ORG };

const SUB_V1 = {
  id: 's1',
  learnerId: 'u-L1',
  courseId: 'c1',
  lessonId: 'l1',
  version: 1,
  files: [],
  status: 'submitted',
  submittedAt: '2026-08-17T09:00:00Z'
};
const RESULT_ROW = {
  id: 'r1',
  submissionId: 's1',
  result: 'PASS',
  feedback: 'Solid work',
  recordedBy: 'u-tutor',
  recordedAt: '2026-08-17T10:00:00Z'
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
  mById.mockResolvedValue(SUB_V1 as never);
  mResult.mockResolvedValue(null as never);
  mLatest.mockResolvedValue({ version: 1, result: null } as never);
  mAllocated.mockResolvedValue(true);
  mRecord.mockResolvedValue(RESULT_ROW as never);
});

// ── Helper truth table (the config decision applied to the latest-marked result value) ────────────
describe('isPassingResult — the passed-helper truth table decision', () => {
  it('no marked submission (null) → not passed', () => expect(isPassingResult(null)).toBe(false));
  it('latest marked Refer → not passed', () => expect(isPassingResult('REFER')).toBe(false));
  it('latest marked Pass → passed', () => expect(isPassingResult('PASS')).toBe(true));
  it('an off-list value → not passed', () => expect(isPassingResult('DISTINCTION')).toBe(false));
  it('every configured value resolves to a boolean', () => {
    for (const v of RESULT_VALUES) expect(typeof isPassingResult(v)).toBe('boolean');
  });
});

// ── recordResult state machine ────────────────────────────────────────────────────────────────
describe('recordResult — mark the latest version', () => {
  it('marks Pass on the latest unmarked version → inserts + returns the result', async () => {
    const row = await recordResult(tutor, 's1', { result: 'PASS', feedback: 'Solid work' });
    expect(row.result).toBe('PASS');
    expect(mRecord).toHaveBeenCalledWith(
      expect.objectContaining({ submissionId: 's1', result: 'PASS', recordedBy: 'u-tutor' })
    );
  });

  it('marks Refer (re-opens the unit — no gating done here)', async () => {
    mRecord.mockResolvedValue({ ...RESULT_ROW, result: 'REFER' } as never);
    const row = await recordResult(tutor, 's1', { result: 'REFER', feedback: 'Please expand section 2' });
    expect(row.result).toBe('REFER');
  });

  it('marking a NON-latest version is rejected (a newer version exists) → 409', async () => {
    mLatest.mockResolvedValue({ version: 2, result: null } as never); // v2 is newer than the v1 being marked
    expect(await code(recordResult(tutor, 's1', { result: 'PASS' }))).toBe(409);
    expect(mRecord).not.toHaveBeenCalled();
  });

  it('re-marking an already-marked version is rejected → 409', async () => {
    mResult.mockResolvedValue(RESULT_ROW as never);
    expect(await code(recordResult(tutor, 's1', { result: 'REFER' }))).toBe(409);
    expect(mRecord).not.toHaveBeenCalled();
  });

  it('unknown submission id → 404', async () => {
    mById.mockResolvedValue(null as never);
    expect(await code(recordResult(tutor, 's-x', { result: 'PASS' }))).toBe(404);
  });
});

// ── Access ───────────────────────────────────────────────────────────────────────────────────
describe('recordResult — allocated tutor OR Admin only', () => {
  it('allocated tutor → allowed', async () => {
    mAllocated.mockResolvedValue(true);
    expect((await recordResult(tutor, 's1', { result: 'PASS' })).id).toBe('r1');
  });
  it('NON-allocated tutor → 403 (no result written)', async () => {
    mAllocated.mockResolvedValue(false);
    expect(await code(recordResult(tutorOther, 's1', { result: 'PASS' }))).toBe(403);
    expect(mRecord).not.toHaveBeenCalled();
  });
  it('Manager → 403', async () => {
    expect(await code(recordResult(manager, 's1', { result: 'PASS' }))).toBe(403);
  });
  it('Learner → 403', async () => {
    expect(await code(recordResult(learner, 's1', { result: 'PASS' }))).toBe(403);
  });
  it('Admin fallback → allowed (no allocation check)', async () => {
    expect((await recordResult(admin, 's1', { result: 'PASS' })).id).toBe('r1');
    expect(mAllocated).not.toHaveBeenCalled();
  });
});

// ── Audit ────────────────────────────────────────────────────────────────────────────────────
describe('recordResult — audits result.entered without feedback text', () => {
  it('writes id + version + result, and NO feedback key', async () => {
    await recordResult(tutor, 's1', { result: 'PASS', feedback: 'private feedback text' });
    expect(mAudit).toHaveBeenCalledTimes(1);
    const call = mAudit.mock.calls[0][0];
    expect(call.action).toBe('result.entered');
    expect(call.metadata).toEqual({ submissionId: 's1', version: 1, result: 'PASS' });
    expect(JSON.stringify(call.metadata)).not.toContain('private feedback');
  });
});
