import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@cio/db/actor';

// PearlLMS — the every-N-units learner→tutor feedback service. Proves (a) the milestone cadence (first at 2,
// then every 5); (b) "due" derivation — null before the first milestone, null once that milestone is
// submitted, null when the learner has no tutor; (c) submit ALWAYS derives the milestone + tutor server-side
// (client values ignored), returns 409 on a duplicate, and audits without PII. The DB query + audit layers
// are mocked so only the service logic runs (no database).

vi.mock('@cio/db/queries/caseload', () => ({ getEnrolmentsForLearners: vi.fn() }));
vi.mock('@cio/db/queries/progress', () => ({ computeLearnerCourseProgress: vi.fn() }));
vi.mock('@cio/db/queries/allocation', () => ({ listTutorsForLearner: vi.fn() }));
vi.mock('@cio/db/queries/auth', () => ({ getProfileById: vi.fn() }));
vi.mock('@cio/db/queries/tutor-feedback', () => ({
  hasTutorFeedback: vi.fn(),
  insertTutorFeedback: vi.fn()
}));
vi.mock('@cio/db/audit', () => ({
  recordAudit: vi.fn(),
  AUDIT_ACTIONS: { TUTOR_FEEDBACK_SUBMITTED: 'tutor_feedback.submitted' }
}));

import { getEnrolmentsForLearners } from '@cio/db/queries/caseload';
import { computeLearnerCourseProgress } from '@cio/db/queries/progress';
import { listTutorsForLearner } from '@cio/db/queries/allocation';
import { getProfileById } from '@cio/db/queries/auth';
import { hasTutorFeedback, insertTutorFeedback } from '@cio/db/queries/tutor-feedback';
import { recordAudit } from '@cio/db/audit';
import { currentTutorFeedbackMilestone } from '@cio/utils/validation/tutor-feedback';
import { getTutorFeedbackStatus, submitTutorFeedback } from '@api/services/lms/tutor-feedback';

const ORG = 'org-1';
const A = (id = 'learner-1'): Actor =>
  ({ authenticated: true, userId: id, role: 'LEARNER', status: 'ACTIVE', orgId: ORG }) as Actor;

/** Make the learner's cross-course passed-units total equal `n` (one course, `n` passed). */
function primePassedUnits(n: number) {
  vi.mocked(getEnrolmentsForLearners).mockResolvedValue([
    { learnerId: 'learner-1', courseId: 'c1', title: 'C', enrolledAt: null }
  ] as never);
  vi.mocked(computeLearnerCourseProgress).mockResolvedValue({
    courseId: 'c1',
    passed: n,
    total: 99,
    completed: false,
    completedAt: null,
    currentPosition: null
  } as never);
}

function primeTutor(present: boolean) {
  if (present) {
    vi.mocked(listTutorsForLearner).mockResolvedValue([{ tutorId: 'tutor-9', email: 't@x.io' }] as never);
    vi.mocked(getProfileById).mockResolvedValue({ id: 'tutor-9', fullname: 'Taylor Tutor' } as never);
  } else {
    vi.mocked(listTutorsForLearner).mockResolvedValue([] as never);
  }
}

beforeEach(() => vi.clearAllMocks());

describe('currentTutorFeedbackMilestone — cadence (first at 2, then every 5)', () => {
  it.each([
    [0, null],
    [1, null],
    [2, 2],
    [6, 2],
    [7, 7],
    [11, 7],
    [12, 12],
    [16, 12],
    [17, 17]
  ])('passedUnits=%i → %s', (units, expected) => {
    expect(currentTutorFeedbackMilestone(units)).toBe(expected);
  });
});

describe('getTutorFeedbackStatus — due derivation', () => {
  it('anonymous is unauthorized', async () => {
    await expect(getTutorFeedbackStatus({ authenticated: false } as Actor)).rejects.toThrowError('Unauthorized');
  });

  it('below the first milestone → nothing due, no tutor lookup', async () => {
    primePassedUnits(1);
    primeTutor(true);
    const r = await getTutorFeedbackStatus(A());
    expect(r).toEqual({ dueMilestone: null, tutor: null });
    expect(listTutorsForLearner).not.toHaveBeenCalled();
  });

  it('at a milestone, not yet submitted, tutor present → due', async () => {
    primePassedUnits(2);
    primeTutor(true);
    vi.mocked(hasTutorFeedback).mockResolvedValue(false);
    const r = await getTutorFeedbackStatus(A());
    expect(r).toEqual({ dueMilestone: 2, tutor: { id: 'tutor-9', name: 'Taylor Tutor' } });
  });

  it('milestone already submitted → not due (wait for the next one)', async () => {
    primePassedUnits(7);
    primeTutor(true);
    vi.mocked(hasTutorFeedback).mockResolvedValue(true);
    const r = await getTutorFeedbackStatus(A());
    expect(r.dueMilestone).toBeNull();
    expect(r.tutor).toEqual({ id: 'tutor-9', name: 'Taylor Tutor' });
  });

  it('no tutor to rate → never due', async () => {
    primePassedUnits(12);
    primeTutor(false);
    const r = await getTutorFeedbackStatus(A());
    expect(r).toEqual({ dueMilestone: null, tutor: null });
    expect(hasTutorFeedback).not.toHaveBeenCalled();
  });
});

describe('submitTutorFeedback — server-derived milestone + tutor, 409 on dup, audit without PII', () => {
  it('anonymous is unauthorized', async () => {
    await expect(submitTutorFeedback({ authenticated: false } as Actor, { overallRating: 5 })).rejects.toThrowError(
      'Unauthorized'
    );
  });

  it('rejects when nothing is due yet', async () => {
    primePassedUnits(1);
    primeTutor(true);
    await expect(submitTutorFeedback(A(), { overallRating: 5 })).rejects.toThrowError('No tutor feedback is due yet');
  });

  it('rejects when the learner has no tutor', async () => {
    primePassedUnits(7);
    primeTutor(false);
    await expect(submitTutorFeedback(A(), { overallRating: 5 })).rejects.toThrowError('no tutor');
  });

  it('stores the SERVER milestone (ignoring a bogus client value) + snapshotted tutor, then audits', async () => {
    primePassedUnits(9); // → milestone 7
    primeTutor(true);
    vi.mocked(insertTutorFeedback).mockResolvedValue({ created: true, row: { id: 'fb-1' } } as never);

    const res = await submitTutorFeedback(A(), {
      overallRating: 4,
      communicationRating: 5,
      comment: '  great  ',
      milestone: 999 // client lie — must be ignored
    });

    expect(res).toEqual({ milestone: 7 });
    expect(insertTutorFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG,
        learnerId: 'learner-1',
        tutorId: 'tutor-9',
        tutorName: 'Taylor Tutor',
        milestone: 7,
        overallRating: 4,
        communicationRating: 5,
        helpfulnessRating: null,
        knowledgeRating: null,
        comment: 'great' // trimmed
      })
    );
    // Audit carries ids + numbers only — never the comment text or any name.
    const auditArg = vi.mocked(recordAudit).mock.calls[0][0];
    expect(auditArg.metadata).toEqual({ tutorId: 'tutor-9', milestone: 7, overallRating: 4, hasComment: true });
    expect(JSON.stringify(auditArg.metadata)).not.toContain('great');
  });

  it('a duplicate submission (same milestone) is a 409', async () => {
    primePassedUnits(2);
    primeTutor(true);
    vi.mocked(insertTutorFeedback).mockResolvedValue({ created: false, row: null } as never);
    await expect(submitTutorFeedback(A(), { overallRating: 3 })).rejects.toThrowError('already been submitted');
    expect(recordAudit).not.toHaveBeenCalled();
  });
});
