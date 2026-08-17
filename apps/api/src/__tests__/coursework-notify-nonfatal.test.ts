import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@cio/db/actor';

// PearlLMS Phase 3 Step 6 — a notification failure must NEVER fail or roll back the submission/marking
// write. Both notify functions are mocked to throw; the parent services must still resolve with their row.

vi.mock('@api/services/coursework/notifications', () => ({
  notifyCourseworkSubmitted: vi.fn(async () => {
    throw new Error('mailer down');
  }),
  notifyCourseworkResulted: vi.fn(async () => {
    throw new Error('mailer down');
  }),
  courseworkEmailsEnabled: vi.fn(() => true)
}));
vi.mock('@cio/db/queries/coursework', () => ({
  createSubmission: vi.fn(),
  getNextSubmissionVersion: vi.fn(),
  getSubmissionById: vi.fn(),
  getResultForSubmission: vi.fn(),
  getLatestSubmissionResultState: vi.fn(),
  recordCourseworkResult: vi.fn(),
  isUnitUploadClosed: vi.fn(),
  listSubmissionsWithResultForLearnerUnit: vi.fn(),
  getSubmissionByFileKey: vi.fn()
}));
vi.mock('@cio/db/queries/allocation', () => ({ isTutorAllocatedToLearner: vi.fn(async () => true) }));
vi.mock('@cio/db/audit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@cio/db/audit')>()),
  recordAudit: vi.fn()
}));
// Phase 5: inert scaffolding for recordResult's same-transaction completion collaborator (passthrough tx +
// no-op trigger) so this Phase-3 non-fatal-mail test exercises the same behaviour. Completion is covered in
// completion-trigger.test.ts.
vi.mock('@cio/db/drizzle', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@cio/db/drizzle')>()),
  runInTransaction: (fn: (tx: unknown) => unknown) => fn({})
}));
vi.mock('@cio/db/queries/completion', () => ({ recordCompletionIfComplete: vi.fn(async () => null) }));

import {
  createSubmission,
  getSubmissionById,
  getResultForSubmission,
  getLatestSubmissionResultState,
  recordCourseworkResult
} from '@cio/db/queries/coursework';
import { notifyCourseworkSubmitted, notifyCourseworkResulted } from '@api/services/coursework/notifications';
import { createCourseworkSubmission } from '@api/services/coursework/coursework';
import { recordResult } from '@api/services/coursework/marking';

const ORG = 'org-1';
const learner: Actor = { authenticated: true, userId: 'u-L', role: 'LEARNER', status: 'ACTIVE', orgId: ORG };
const tutor: Actor = { authenticated: true, userId: 'u-tutor', role: 'TUTOR', status: 'ACTIVE', orgId: ORG };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createCourseworkSubmission — mail failure is non-fatal', () => {
  it('still returns the recorded submission when the tutor notification throws', async () => {
    vi.mocked(createSubmission).mockResolvedValue({
      id: 's1',
      learnerId: 'u-L',
      courseId: 'c1',
      lessonId: 'l1',
      version: 1,
      files: [],
      status: 'submitted',
      submittedAt: 't'
    } as never);
    const key = 'coursework/c1/u-L/l1/1/nano-a.docx';
    const row = await createCourseworkSubmission(learner, 'c1', 'l1', 1, [{ key, name: 'a.docx' }]);
    expect(row.id).toBe('s1');
    expect(vi.mocked(notifyCourseworkSubmitted)).toHaveBeenCalledTimes(1); // it fired (and threw) but didn't break the write
  });
});

describe('recordResult — mail failure is non-fatal', () => {
  it('still returns the recorded result when the learner notification throws', async () => {
    vi.mocked(getSubmissionById).mockResolvedValue({
      id: 's1',
      learnerId: 'u-L',
      courseId: 'c1',
      lessonId: 'l1',
      version: 1,
      files: [],
      status: 'submitted',
      submittedAt: 't'
    } as never);
    vi.mocked(getResultForSubmission).mockResolvedValue(null as never);
    vi.mocked(getLatestSubmissionResultState).mockResolvedValue({ version: 1, result: null } as never);
    vi.mocked(recordCourseworkResult).mockResolvedValue({
      id: 'r1',
      submissionId: 's1',
      result: 'PASS',
      feedback: 'ok',
      recordedBy: 'u-tutor',
      recordedAt: 't'
    } as never);

    const row = await recordResult(tutor, 's1', { result: 'PASS', feedback: 'ok' });
    expect(row.id).toBe('r1');
    expect(vi.mocked(notifyCourseworkResulted)).toHaveBeenCalledTimes(1);
  });
});
