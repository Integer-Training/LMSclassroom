import { AppError, ErrorCodes } from '@api/utils/errors';
import type { Actor } from '@cio/db/actor';
import { AUDIT_ACTIONS, recordAudit } from '@cio/db/audit';
import { isUniqueConstraintViolation } from '@cio/utils/errors';
import { isPassingResult } from '@cio/utils/constants';
import { runInTransaction } from '@cio/db/drizzle';
import {
  getLatestSubmissionResultState,
  getResultForSubmission,
  getSubmissionById,
  recordCourseworkResult,
  type CourseworkResultRow
} from '@cio/db/queries/coursework';
import { recordCompletionIfComplete, type CompletionRow } from '@cio/db/queries/completion';
import { isAllocatedTutor } from '@api/middlewares/guards';
import { notifyCourseworkResulted } from '@api/services/coursework/notifications';

// Tutor marking (PearlLMS Phase 3 Step 5). The tutor assesses OFF-platform; this records the outcome
// only — one result value (from config) + one free-text feedback field — against ONE submission version.
// State machine: mark the LATEST version; a REFER re-opens the unit (upload stays open); a PASS on the
// latest version closes upload (enforced in requireCourseworkSubmit). History is never overwritten:
// one result per version (DB unique), and re-marking / marking a superseded version are rejected.

export interface RecordResultInput {
  result: string;
  feedback?: string;
}

/**
 * Record a tutor's result + feedback against a submission version. Access: ADMIN, or a TUTOR allocated
 * to the submission's learner — Manager, Learner and non-allocated tutors are denied (403). Rejects
 * marking a superseded version (409) or re-marking an already-marked version (409). Audits
 * `result.entered` with the submission id + version + result value — NEVER the feedback text.
 */
export async function recordResult(
  actor: Actor,
  submissionId: string,
  input: RecordResultInput
): Promise<CourseworkResultRow> {
  if (!actor.authenticated) {
    throw new AppError('Unauthorized', ErrorCodes.UNAUTHORIZED, 401);
  }

  const submission = await getSubmissionById(submissionId);
  if (!submission) {
    throw new AppError('Submission not found', ErrorCodes.NOT_FOUND, 404);
  }

  const allowed =
    actor.role === 'ADMIN' || (actor.role === 'TUTOR' && (await isAllocatedTutor(actor, submission.learnerId)));
  if (!allowed) {
    throw new AppError('Only an allocated tutor or an admin can record a result', ErrorCodes.FORBIDDEN, 403);
  }

  // One result per version — never overwrite history.
  if (await getResultForSubmission(submissionId)) {
    throw new AppError('This version has already been marked', ErrorCodes.CONFLICT, 409);
  }

  // Only the latest version of a unit is markable — a newer version means this one is superseded.
  const latest = await getLatestSubmissionResultState(submission.learnerId, submission.lessonId);
  if (latest && submission.version < latest.version) {
    throw new AppError('A newer version has been submitted — mark the latest version', ErrorCodes.CONFLICT, 409);
  }

  // The result insert AND the completion evaluation share ONE transaction: the completion rule must
  // read-your-writes to see this just-recorded Pass, and the completion row must be atomic with the result
  // that completed the course. Completion is evaluated ONLY for a passing result (a Refer can never
  // complete a course). This ADDS to marking — the verdict/feedback/versioning are untouched.
  let row: CourseworkResultRow;
  let newCompletion: CompletionRow | null = null;
  try {
    const outcome = await runInTransaction(async (tx) => {
      const resultRow = await recordCourseworkResult(
        {
          submissionId,
          result: input.result,
          feedback: input.feedback ?? null,
          recordedBy: actor.userId
        },
        tx
      );
      const completion = isPassingResult(input.result)
        ? await recordCompletionIfComplete(tx, {
            learnerId: submission.learnerId,
            courseId: submission.courseId,
            completedAt: resultRow.recordedAt
          })
        : null;
      return { resultRow, completion };
    });
    row = outcome.resultRow;
    newCompletion = outcome.completion;
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      throw new AppError('This version has already been marked', ErrorCodes.CONFLICT, 409);
    }
    throw error;
  }

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.RESULT_ENTERED,
    entityType: 'coursework_result',
    entityId: row.id,
    metadata: { submissionId, version: submission.version, result: input.result } // NEVER the feedback text
  });

  // A completion row was newly written → audit it (ids only). Fired ONLY on a genuine new insert — the
  // idempotent ON CONFLICT no-op returns null, so a repeat/concurrent completing mark records no second audit.
  if (newCompletion) {
    await recordAudit({
      actor,
      action: AUDIT_ACTIONS.COMPLETION_RECORDED,
      entityType: 'course_completion',
      entityId: newCompletion.id,
      metadata: { learnerId: submission.learnerId, courseId: submission.courseId, completionId: newCompletion.id }
    });
  }

  // Notify the learner that feedback is available — fire-and-forget: a mail failure must never roll back
  // the result that was just recorded.
  try {
    await notifyCourseworkResulted({
      learnerId: submission.learnerId,
      courseId: submission.courseId,
      lessonId: submission.lessonId
    });
  } catch (error) {
    console.error('[coursework] result notification failed (result still recorded):', error);
  }

  return row;
}
