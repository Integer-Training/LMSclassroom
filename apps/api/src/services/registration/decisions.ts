import { AppError, ErrorCodes } from '@api/utils/errors';
import type { Actor } from '@cio/db/actor';
import { isRole } from '@cio/utils/auth';
import { runInTransaction } from '@cio/db/drizzle';
import { AUDIT_ACTIONS, recordAudit } from '@cio/db/audit';
import type { RegistrationStatus } from '@cio/utils/constants';
import {
  listRegistrations,
  getRegistrationById,
  claimPendingRegistration,
  type RegistrationQueueRow
} from '@cio/db/queries/registration';
import { checkEmailExistsInOrg } from '@cio/db/queries/organization';
import { listPublishedCoursesForOrg } from '@cio/db/queries/onboarding';
import { onboardLearner } from '@api/services/onboarding/onboarding';

// PearlLMS Phase 7 Step 3 — the Manager/Admin approval queue (docs/ONBOARDING-MODEL.md §4/§5). Approve COMPOSES
// the Phase-5 lite-onboarding service (onboardLearner) — there is NO second create+enrol path here. The
// one-way state machine + race-safety come from claimPendingRegistration's atomic compare-and-swap
// (`WHERE status = 'pending'`) inside a transaction: exactly one decision wins, and a downstream failure rolls
// the flip back. The applicant's account creation inherits Phase-5's fail-before-write + best-effort-invite
// contract (creation stands, invite resendable) — auth-user creation is outside drizzle's tx, so the atomic
// guarantee is at the REGISTRATION level (it never flips to decided unless the decision path succeeds).

function assertStaff(actor: Actor): asserts actor is Extract<Actor, { authenticated: true }> {
  if (!actor.authenticated) throw new AppError('Unauthorized', ErrorCodes.UNAUTHORIZED, 401);
  if (!isRole(actor, 'ADMIN', 'MANAGER')) throw new AppError('Forbidden', ErrorCodes.FORBIDDEN, 403);
}

function nowIso(): string {
  return new Date().toISOString();
}

export interface ApproveResult {
  userId: string;
  courseId: string;
  courseTitle: string | null;
  learnerName: string;
}

/** The org's registration queue (Manager/Admin). Oldest-first; optional status filter (default: pending). */
export async function listRegistrationQueue(
  actor: Actor,
  status?: RegistrationStatus
): Promise<RegistrationQueueRow[]> {
  assertStaff(actor);
  return listRegistrations(actor.orgId, status);
}

/** Published courses (id + title) for the approve course selector — Manager/Admin, org-scoped. */
export async function listApprovalCourses(actor: Actor): Promise<{ courseId: string; title: string | null }[]> {
  assertStaff(actor);
  return listPublishedCoursesForOrg(actor.orgId);
}

/** A single application's detail (Manager/Admin, org-scoped). */
export async function getRegistrationDetail(actor: Actor, id: string): Promise<RegistrationQueueRow> {
  assertStaff(actor);
  const row = await getRegistrationById(actor.orgId, id);
  if (!row) throw new AppError('Registration not found', ErrorCodes.NOT_FOUND, 404);
  return row;
}

/**
 * Approve an application: atomically claim the pending row, then create the user + enrolment + credential invite
 * via the Phase-5 service. Race-safe (a double-fire yields one account); one-way (a decided row is refused);
 * duplicate-safe (an email that gained an account since submission is refused, not double-created).
 */
export async function approveRegistration(
  actor: Actor,
  registrationId: string,
  opts: { courseId?: string | null } = {}
): Promise<ApproveResult> {
  assertStaff(actor);
  const orgId = actor.orgId;

  const result = await runInTransaction(async (tx) => {
    // Claim (compare-and-swap) — flips to 'approved' ONLY if still pending; a concurrent approval blocks then
    // matches zero rows. If anything below throws, the tx rolls this flip back to 'pending'.
    const claimed = await claimPendingRegistration(tx, orgId, registrationId, {
      status: 'approved',
      decidedBy: actor.userId,
      decidedAt: nowIso()
    });
    if (!claimed) {
      throw new AppError(
        'This application is no longer pending (already decided or not found).',
        ErrorCodes.CONFLICT,
        409
      );
    }

    // Duplicate-since-submission: an account for this email already exists (e.g. onboarded manually).
    if (await checkEmailExistsInOrg(orgId, claimed.email)) {
      throw new AppError(
        'An account already exists for this email — cannot approve.',
        ErrorCodes.CONFLICT,
        409,
        'email'
      );
    }

    const courseId = opts.courseId ?? claimed.requestedCourseId;
    if (!courseId) {
      throw new AppError(
        'Select a course before approving this application.',
        ErrorCodes.VALIDATION_ERROR,
        400,
        'courseId'
      );
    }

    // Compose Phase 5 — the ONLY create+enrol+invite path. Its own writes/auth are outside this tx, but the
    // registration flip is not committed unless this succeeds.
    const onboard = await onboardLearner(actor, { name: claimed.fullName, email: claimed.email, courseId });
    return {
      userId: onboard.userId,
      courseId,
      courseTitle: onboard.courseTitle,
      learnerName: onboard.learnerName
    };
  });

  // Audit only after the decision committed (ids only — never the applicant's name/email).
  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.REGISTRATION_APPROVED,
    entityType: 'registration',
    entityId: registrationId,
    metadata: { registrationId, courseId: result.courseId }
  });

  return result;
}

/** Reject an application: status + required note + decided_by/at; one-way; audited. Nothing is created. */
export async function rejectRegistration(
  actor: Actor,
  registrationId: string,
  input: { note: string }
): Promise<{ id: string; status: 'rejected' }> {
  assertStaff(actor);
  const orgId = actor.orgId;
  const note = (input.note ?? '').trim();
  if (!note) {
    throw new AppError('A note is required to reject an application.', ErrorCodes.VALIDATION_ERROR, 400, 'note');
  }

  const claimed = await runInTransaction(async (tx) => {
    const row = await claimPendingRegistration(tx, orgId, registrationId, {
      status: 'rejected',
      decidedBy: actor.userId,
      decidedAt: nowIso(),
      decisionNote: note
    });
    if (!row) {
      throw new AppError(
        'This application is no longer pending (already decided or not found).',
        ErrorCodes.CONFLICT,
        409
      );
    }
    return row;
  });

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.REGISTRATION_REJECTED,
    entityType: 'registration',
    entityId: registrationId,
    metadata: { registrationId } // the note lives on the row, NEVER in audit metadata
  });

  return { id: claimed.id, status: 'rejected' };
}
