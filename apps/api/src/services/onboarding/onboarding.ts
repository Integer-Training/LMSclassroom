import { AppError, ErrorCodes } from '@api/utils/errors';
import type { Actor } from '@cio/db/actor';
import { ROLE } from '@cio/utils/constants';
import { addCourseMember } from '@cio/db/queries/course';
import {
  getCourseEnrolmentTarget,
  listPublishedCoursesForOrg,
  type OnboardingCourse
} from '@cio/db/queries/onboarding';
import { createOrgUser } from '@api/services/organization/users';
import { ensureComplianceEnrollmentRecordsForProfiles } from '@api/services/course/compliance';

// PearlLMS Phase 5 Step 5 — lite learner onboarding (docs/PROGRESS-MODEL.md §6). Admin-only (guarded at the
// route). This COMPOSES existing machinery — Phase 1's createOrgUser (account + set-password credential +
// user.created audit) and the existing course enrolment (addCourseMember) — and builds NO parallel flow.
//
// Order matters for "nothing partially created":
//   1. Validate the course (exists / in the actor's org / published / has a group) — fails BEFORE any write.
//   2. createOrgUser — provisions the Better Auth account and 409s on a duplicate email, so a duplicate
//      fails BEFORE the account row and there is nothing to roll back.
//   3. Enrol into the pre-validated course — a plain insert. A failure here (very unlikely post-validation)
//      follows the Phase-3 rule: the account + credential email persist; we surface an actionable error
//      rather than pretending it rolled back.
// The credential is the learner's OWN login, set from the set-password link createOrgUser sends — no
// generated-password mechanics. A resend uses the standard Better Auth password-reset ("Forgot password"); no
// new mechanic is introduced here. The audit is the existing user.created (this flow adds no new action).

function assertAuthed(actor: Actor): asserts actor is Extract<Actor, { authenticated: true }> {
  if (!actor.authenticated) throw new AppError('Unauthorized', ErrorCodes.UNAUTHORIZED, 401);
}

export interface OnboardLearnerInput {
  name: string;
  email: string;
  courseId: string;
}

export interface OnboardLearnerResult {
  userId: string;
  courseId: string;
  courseTitle: string | null;
  learnerName: string;
}

/** Published courses in the actor's org, for the onboarding course selector. */
export async function listOnboardingCourses(actor: Actor): Promise<OnboardingCourse[]> {
  assertAuthed(actor);
  return listPublishedCoursesForOrg(actor.orgId);
}

/** Onboard one learner: create account (Learner) + enrol into a course + issue the credential invite. */
export async function onboardLearner(actor: Actor, input: OnboardLearnerInput): Promise<OnboardLearnerResult> {
  assertAuthed(actor);
  const orgId = actor.orgId;
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();

  if (!name) throw new AppError('A name is required', ErrorCodes.VALIDATION_ERROR, 400, 'name');

  // 1. Validate the enrolment target BEFORE provisioning anything.
  const target = await getCourseEnrolmentTarget(input.courseId);
  if (!target) throw new AppError('Course not found', ErrorCodes.NOT_FOUND, 404);
  if (target.orgId !== orgId) {
    throw new AppError('You do not have access to this course', ErrorCodes.FORBIDDEN, 403);
  }
  if (!target.isPublished) {
    throw new AppError('This course is not published', ErrorCodes.VALIDATION_ERROR, 400, 'courseId');
  }
  if (!target.groupId) {
    throw new AppError('This course cannot be enrolled into', ErrorCodes.VALIDATION_ERROR, 400, 'courseId');
  }

  // 2. Provision the account (Phase 1). Throws 409 on a duplicate email — nothing created past this point.
  const { userId } = await createOrgUser(orgId, actor, { name, email, roleId: ROLE.STUDENT });

  // 3. Enrol into the pre-validated course. Post-provision failure follows the Phase-3 rule (account persists).
  try {
    await addCourseMember(input.courseId, { profileId: userId, roleId: ROLE.STUDENT, email });
    await ensureComplianceEnrollmentRecordsForProfiles([input.courseId], [userId]);
  } catch (error) {
    console.error('[onboarding] enrolment failed after account creation (account + invite persist):', error);
    throw new AppError(
      'The learner account was created and the invite sent, but enrolment failed — add them to the course from the People page.',
      ErrorCodes.INTERNAL_ERROR,
      500
    );
  }

  return { userId, courseId: input.courseId, courseTitle: target.title, learnerName: name };
}
