import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@cio/db/actor';

// PearlLMS Phase 5 Step 2 — the completion TRIGGER inside recordResult (TEST-FIRST). Recording the
// qualifying Pass writes exactly one completion row IN THE SAME TRANSACTION and audits `completion.recorded`
// (ids only). A Pass that does not complete the course, and any Refer, write no completion. The result
// insert + completion insert share one transaction (runInTransaction, mocked here to a passthrough); real
// transactionality + ON-CONFLICT idempotency are proven in the live harness. Marking semantics are unchanged
// — result.entered still fires exactly as in Phase 3.

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
vi.mock('@api/services/coursework/notifications', () => ({
  notifyCourseworkSubmitted: vi.fn(),
  notifyCourseworkResulted: vi.fn(),
  courseworkEmailsEnabled: vi.fn(() => true)
}));
// Transaction boundary → passthrough with a stub tx so the unit test never opens a real connection.
vi.mock('@cio/db/drizzle', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@cio/db/drizzle')>()),
  runInTransaction: (fn: (tx: unknown) => unknown) => fn({})
}));
vi.mock('@cio/db/queries/completion', () => ({ recordCompletionIfComplete: vi.fn() }));
// Phase 6: recordResult emits session.unlocked on a Pass — inert mocks keep this test hermetic.
vi.mock('@api/services/gating/unlock', () => ({ getUnitsUnlockedByPass: vi.fn(async () => []) }));
vi.mock('@api/services/comms/notify', () => ({ emitNotification: vi.fn() }));

import {
  getSubmissionById,
  getResultForSubmission,
  getLatestSubmissionResultState,
  recordCourseworkResult
} from '@cio/db/queries/coursework';
import { isTutorAllocatedToLearner } from '@cio/db/queries/allocation';
import { recordAudit } from '@cio/db/audit';
import { recordCompletionIfComplete } from '@cio/db/queries/completion';
import { recordResult } from '@api/services/coursework/marking';

const mById = vi.mocked(getSubmissionById);
const mResult = vi.mocked(getResultForSubmission);
const mLatest = vi.mocked(getLatestSubmissionResultState);
const mRecord = vi.mocked(recordCourseworkResult);
const mAllocated = vi.mocked(isTutorAllocatedToLearner);
const mAudit = vi.mocked(recordAudit);
const mComplete = vi.mocked(recordCompletionIfComplete);

const ORG = 'org-1';
const tutor: Actor = { authenticated: true, userId: 'u-tutor', role: 'TUTOR', status: 'ACTIVE', orgId: ORG };
const SUB = {
  id: 's1',
  learnerId: 'u-L1',
  courseId: 'c1',
  lessonId: 'l3',
  version: 1,
  files: [],
  status: 'submitted',
  submittedAt: '2026-08-17T09:00:00Z'
};
const RESULT_ROW = {
  id: 'r1',
  submissionId: 's1',
  result: 'PASS',
  feedback: 'ok',
  recordedBy: 'u-tutor',
  recordedAt: '2026-08-17T10:00:00Z'
};
const COMPLETION_ROW = {
  id: 'cc1',
  learnerId: 'u-L1',
  courseId: 'c1',
  completedAt: '2026-08-17T10:00:00Z',
  createdAt: 'x'
};

const auditCalls = (action: string) => mAudit.mock.calls.filter((c) => c[0].action === action);

beforeEach(() => {
  vi.clearAllMocks();
  mById.mockResolvedValue(SUB as never);
  mResult.mockResolvedValue(null as never);
  mLatest.mockResolvedValue({ version: 1, result: null } as never);
  mAllocated.mockResolvedValue(true);
  mRecord.mockResolvedValue(RESULT_ROW as never);
  mComplete.mockResolvedValue(null); // default: not the completing pass
});

describe('recordResult — completion trigger fires only on the qualifying Pass', () => {
  it('Pass that COMPLETES the course → one completion.recorded audit with id-only metadata', async () => {
    mComplete.mockResolvedValue(COMPLETION_ROW);
    await recordResult(tutor, 's1', { result: 'PASS', feedback: 'final unit ok' });

    // evaluated with the learner + course from the submission, completedAt = the result's recordedAt
    expect(mComplete).toHaveBeenCalledTimes(1);
    expect(mComplete.mock.calls[0][1]).toEqual({
      learnerId: 'u-L1',
      courseId: 'c1',
      completedAt: '2026-08-17T10:00:00Z'
    });

    const completionAudits = auditCalls('completion.recorded');
    expect(completionAudits).toHaveLength(1);
    expect(completionAudits[0][0].metadata).toEqual({ learnerId: 'u-L1', courseId: 'c1', completionId: 'cc1' });
    // id-only: no PII keys anywhere in the metadata
    expect(JSON.stringify(completionAudits[0][0].metadata)).not.toMatch(/email|name|feedback/i);
  });

  it('Pass that does NOT complete the course → no completion audit (result.entered only)', async () => {
    mComplete.mockResolvedValue(null);
    await recordResult(tutor, 's1', { result: 'PASS' });
    expect(auditCalls('completion.recorded')).toHaveLength(0);
    expect(auditCalls('result.entered')).toHaveLength(1);
  });

  it('REFER never evaluates completion (a Refer can never complete a course)', async () => {
    mRecord.mockResolvedValue({ ...RESULT_ROW, result: 'REFER' } as never);
    await recordResult(tutor, 's1', { result: 'REFER', feedback: 'redo' });
    expect(mComplete).not.toHaveBeenCalled();
    expect(auditCalls('completion.recorded')).toHaveLength(0);
  });

  it('idempotent: a repeat Pass whose completion already exists writes no second audit', async () => {
    // recordCompletionIfComplete returns null when the row already exists (ON CONFLICT no-op)
    mComplete.mockResolvedValue(null);
    await recordResult(tutor, 's1', { result: 'PASS' });
    expect(auditCalls('completion.recorded')).toHaveLength(0);
  });

  it('the result is still recorded + result.entered audited exactly as before (marking unchanged)', async () => {
    mComplete.mockResolvedValue(COMPLETION_ROW);
    const row = await recordResult(tutor, 's1', { result: 'PASS' });
    expect(row.id).toBe('r1');
    expect(mRecord).toHaveBeenCalledWith(
      expect.objectContaining({ submissionId: 's1', result: 'PASS', recordedBy: 'u-tutor' }),
      expect.anything() // now receives the tx client
    );
    expect(auditCalls('result.entered')).toHaveLength(1);
  });
});
