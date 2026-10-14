import type { Actor } from '@cio/db/actor';
import { AppError, ErrorCodes } from '@api/utils/errors';
import { getEnrolmentsForLearners } from '@cio/db/queries/caseload';
import { computeLearnerCourseProgress } from '@cio/db/queries/progress';
import { listTutorsForLearner } from '@cio/db/queries/allocation';
import { getProfileById } from '@cio/db/queries/auth';
import { hasTutorFeedback, insertTutorFeedback } from '@cio/db/queries/tutor-feedback';
import { currentTutorFeedbackMilestone, type TutorFeedbackSubmitInput } from '@cio/utils/validation/tutor-feedback';
import { recordAudit, AUDIT_ACTIONS } from '@cio/db/audit';

// PearlLMS — periodic learner→tutor feedback (the "every-N-units" popup, Feature 2). Learner-self only: the
// learner is ALWAYS the authenticated actor (never a param), the milestone is ALWAYS recomputed server-side
// from their real passed-units count, and the tutor is resolved server-side — the client is never trusted
// with any of these. "Due" is derived (no event hook): the current milestone minus any already-submitted
// one. Stored feedback is admin-only (see getTutorFeedbackReport in services/dash/reports).

/** Total passed units across ALL the learner's courses — the exact figure the /lms dashboard shows. */
async function computePassedUnits(learnerId: string): Promise<number> {
  const enrolments = await getEnrolmentsForLearners([learnerId]);
  if (enrolments.length === 0) return 0;
  const progress = await Promise.all(enrolments.map((e) => computeLearnerCourseProgress(learnerId, e.courseId)));
  return progress.reduce((a, p) => a + p.passed, 0);
}

/** The learner's current tutor (allocated-first, same pick as the /lms "My Tutor" card), or null if none. */
async function resolveCurrentTutor(learnerId: string): Promise<{ id: string; name: string } | null> {
  const tutors = await listTutorsForLearner(learnerId);
  const first = tutors[0];
  if (!first) return null;
  const profile = await getProfileById(first.tutorId);
  return { id: first.tutorId, name: profile?.fullname ?? 'Your tutor' };
}

export interface TutorFeedbackStatus {
  /** The milestone the learner owes feedback for right now, or null when nothing is due. */
  dueMilestone: number | null;
  /** The tutor the feedback would be about (shown in the prompt), or null when there is no tutor to rate. */
  tutor: { id: string; name: string } | null;
}

/** Is tutor feedback due for the calling learner? Derived from passed units + already-submitted milestones. */
export async function getTutorFeedbackStatus(actor: Actor): Promise<TutorFeedbackStatus> {
  if (!actor.authenticated) throw new AppError('Unauthorized', ErrorCodes.UNAUTHORIZED, 401);
  const learnerId = actor.userId;

  const passedUnits = await computePassedUnits(learnerId);
  const milestone = currentTutorFeedbackMilestone(passedUnits);
  if (milestone === null) return { dueMilestone: null, tutor: null };

  // No resolvable tutor → nothing/nobody to rate; never prompt.
  const tutor = await resolveCurrentTutor(learnerId);
  if (!tutor) return { dueMilestone: null, tutor: null };

  const already = await hasTutorFeedback(learnerId, milestone);
  return { dueMilestone: already ? null : milestone, tutor };
}

/** Record one feedback submission for the calling learner. Milestone + tutor are server-derived; 409 on dup. */
export async function submitTutorFeedback(
  actor: Actor,
  input: TutorFeedbackSubmitInput
): Promise<{ milestone: number }> {
  if (!actor.authenticated) throw new AppError('Unauthorized', ErrorCodes.UNAUTHORIZED, 401);
  const learnerId = actor.userId;

  const passedUnits = await computePassedUnits(learnerId);
  const milestone = currentTutorFeedbackMilestone(passedUnits);
  if (milestone === null) {
    throw new AppError('No tutor feedback is due yet', ErrorCodes.VALIDATION_ERROR, 400);
  }
  const tutor = await resolveCurrentTutor(learnerId);
  if (!tutor) {
    throw new AppError('You have no tutor to give feedback about yet', ErrorCodes.VALIDATION_ERROR, 400);
  }

  const comment = input.comment?.trim() ? input.comment.trim() : null;

  const { created, row } = await insertTutorFeedback({
    organizationId: actor.orgId,
    learnerId,
    tutorId: tutor.id,
    tutorName: tutor.name,
    milestone,
    overallRating: input.overallRating,
    communicationRating: input.communicationRating ?? null,
    helpfulnessRating: input.helpfulnessRating ?? null,
    knowledgeRating: input.knowledgeRating ?? null,
    comment
  });

  if (!created || !row) {
    throw new AppError('Feedback for this milestone has already been submitted', ErrorCodes.CONFLICT, 409);
  }

  // Audit: ids + milestone + rating numbers only — never the comment text, never any name.
  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.TUTOR_FEEDBACK_SUBMITTED,
    entityType: 'tutor_feedback',
    entityId: row.id,
    metadata: { tutorId: tutor.id, milestone, overallRating: input.overallRating, hasComment: !!comment }
  });

  return { milestone };
}
