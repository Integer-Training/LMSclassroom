import { Context, Next } from 'hono';

import { ErrorCodes } from '@api/utils/errors';
import type { Actor } from '@cio/db/actor';
import { isAllocatedTutor, isRole, isSelf, sameOrg } from '@cio/utils/auth';
import { getSubmissionById } from '@cio/db/queries/submission';
import { isCourseGroupMember } from '@cio/db/queries/group';
import { getCourseById } from '@cio/db/queries/course';
import { forbidden, unauthorized } from '@api/middlewares/guards/require-role';

// Ownership / scope guards — the request-aware layer on top of the pure predicates in
// @cio/utils/auth. They read `c.get('actor')` and an id/scope pulled from the request, and deny
// by default. Knowing a URL or an object id must never, by itself, widen access.

/**
 * Every organization id the client supplies (header `cio-org-id`, `?organizationId`/`?orgId`, and
 * optionally a `:param`) must equal the actor's RESOLVED org. PearlLMS is single-org, so the
 * authoritative scope is `actor.orgId` — this makes a caller unable to pull another org's data by
 * pairing their own header with someone else's `?orgId` (closes the cross-org `?orgId` / quiz
 * holes). Missing claims are fine (the handler then scopes to `actor.orgId`); a MISMATCH is 403.
 */
export function requireSameOrg(opts: { param?: string } = {}) {
  return async (c: Context, next: Next) => {
    const actor = c.get('actor') as Actor | undefined;
    if (!actor?.authenticated) return unauthorized(c);

    const claims = [
      c.req.header('cio-org-id'),
      c.req.query('organizationId'),
      c.req.query('orgId'),
      opts.param ? c.req.param(opts.param) : undefined
    ].filter((v): v is string => typeof v === 'string' && v.length > 0);

    for (const claim of claims) {
      if (!sameOrg(actor, claim)) {
        return forbidden(c, 'This resource belongs to a different organization');
      }
    }

    return next();
  };
}

/** The `:param` user id must be the caller themselves (Admin may be allowed via `orAdmin`). */
export function requireSelfParam(paramName: string, opts: { orAdmin?: boolean } = {}) {
  return async (c: Context, next: Next) => {
    const actor = c.get('actor') as Actor | undefined;
    if (!actor?.authenticated) return unauthorized(c);

    const target = c.req.param(paramName);
    if (isSelf(actor, target)) return next();
    if (opts.orAdmin && actor.role === 'ADMIN') return next();

    return forbidden(c, 'You can only access your own record');
  };
}

/**
 * Access to marking / gradebook / submission-grading.
 *  - ADMIN: always (course author / oversight).
 *  - TUTOR: only for an allocated learner — and the allocation table does not exist until Phase 3,
 *    so `isAllocatedTutor` denies. A tutor therefore reaches NO learner's marks in Phase 1. When a
 *    specific learner is in scope, pass a resolver; whole-class endpoints (gradebook) pass none →
 *    tutor is denied outright (you cannot be "allocated to the whole class").
 *  - LEARNER / MANAGER: denied (learners never see marks endpoints; managers get reports in P5).
 */
export function requireMarkingAccess(getLearnerId?: (c: Context) => string | null | undefined) {
  return async (c: Context, next: Next) => {
    const actor = c.get('actor') as Actor | undefined;
    if (!actor?.authenticated) return unauthorized(c);

    if (actor.role === 'ADMIN') return next();
    if (actor.role === 'TUTOR' && isAllocatedTutor(actor, getLearnerId?.(c))) return next();

    return forbidden(c, 'Only the course admin (or an allocated tutor) can access marking');
  };
}

/** 404 helper — hide existence from callers who shouldn't know the resource is there. */
export function notFound(c: Context, message = 'Not found') {
  return c.json({ success: false, error: message, code: ErrorCodes.NOT_FOUND }, 404);
}

/**
 * Bind the `:submissionId` to the path `:courseId`. The submission-grading services load a
 * submission purely by id and never check it belongs to the course in the URL, so a tutor/admin of
 * course A could grade/read/delete a course-B submission by pairing A's path with B's id
 * (ACCESS.md gap A). This loads the submission and 404s on a course mismatch (404, not 403 — do not
 * reveal that the id exists in another course). Runs after requireMarkingAccess.
 */
export async function bindSubmissionToCourse(c: Context, next: Next) {
  const courseId = c.req.param('courseId');
  const submissionId = c.req.param('submissionId');
  if (!courseId || !submissionId) return notFound(c, 'Submission not found');

  const submission = await getSubmissionById(submissionId);
  if (!submission || submission.courseId !== courseId) return notFound(c, 'Submission not found');

  return next();
}

// ── Course content access (PearlLMS Phase 2) ────────────────────────────────────────────────────
// DB-backed enrolment predicates that back the learner-content-read + material-download guards.
// The pure @cio/utils/auth predicates can't reach the DB, so the enrolment check lives here, next
// to the other request-aware ownership rules. Rule (docs/ACCESS.md): a learner reads content only
// for a course they are enrolled in AND that is published; any staff role reads regardless.

/** Staff for content purposes: Admin (author), Tutor (support), Manager (provider-wide read). */
function isContentStaff(actor: Actor): boolean {
  return isRole(actor, 'ADMIN', 'TUTOR', 'MANAGER');
}

/**
 * Is the actor enrolled in this course — i.e. a member of the course's group? Enrolment alone,
 * with no role/publish inference: staff bypass and the draft gate are applied by the caller
 * (canReadCourseContent). Anonymous/deactivated actors (authenticated:false) are always false.
 */
export async function isEnrolledLearner(actor: Actor, courseId: string): Promise<boolean> {
  if (!actor.authenticated) return false;
  return isCourseGroupMember(courseId, actor.userId);
}

/** A course is learner-visible only when BOTH flags agree (COURSE-MODEL.md §1). */
async function isCoursePublished(courseId: string): Promise<boolean> {
  const [course] = await getCourseById(courseId);
  return !!course && course.isPublished === true && course.status === 'ACTIVE';
}

/**
 * The content-read decision for a course's lessons/materials:
 *  - any staff role (Admin/Tutor/Manager) → true, including draft courses (authoring/oversight);
 *  - otherwise a learner → only if enrolled AND the course is published (no draft leakage);
 *  - anonymous/deactivated → false.
 * Pure boolean so both a route guard and the material-download key-binding can share one rule.
 */
export async function canReadCourseContent(actor: Actor, courseId: string): Promise<boolean> {
  if (!actor.authenticated) return false;
  if (isContentStaff(actor)) return true;
  if (!(await isEnrolledLearner(actor, courseId))) return false;
  return isCoursePublished(courseId);
}
