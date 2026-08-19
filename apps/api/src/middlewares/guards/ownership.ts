import { Context, Next } from 'hono';

import { AppError, ErrorCodes } from '@api/utils/errors';
import type { Actor } from '@cio/db/actor';
import { isRole, isSelf, sameOrg } from '@cio/utils/auth';
import { getSubmissionById } from '@cio/db/queries/submission';
import { isCourseGroupMember } from '@cio/db/queries/group';
import { isTutorAllocatedToLearner } from '@cio/db/queries/allocation';
import { getSubmissionByFileKey, hasLearnerPassedUnit, isUnitUploadClosed } from '@cio/db/queries/coursework';
import { getCourseMaterialKeys, getMaterialKeyLessonMap } from '@cio/db/queries/lesson';
import { getCourseSequentialUnlock, getOrderedUnitsForCourse } from '@cio/db/queries/gating';
import { findGatePredecessorIndex, isExemptUnitType } from '@cio/utils/constants';
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
    if (actor.role === 'TUTOR' && (await isAllocatedTutor(actor, getLearnerId?.(c)))) return next();

    return forbidden(c, 'Only the course admin (or an allocated tutor) can access marking');
  };
}

/**
 * The caller is a TUTOR allocated to this learner — the real, DB-backed replacement for the Phase-1
 * pure deny-stub (`@cio/utils/auth`). Allocation is PROVIDER-WIDE: a tutor's staff-ness is per-learner,
 * not per-course. Only a TUTOR actor can be allocated; anonymous/Admin/Manager/Learner → false here
 * (Admin's marking access is granted separately in requireMarkingAccess). Backed by `tutor_allocation`.
 */
export async function isAllocatedTutor(actor: Actor, learnerId: string | null | undefined): Promise<boolean> {
  if (!actor.authenticated || actor.role !== 'TUTOR' || !learnerId) return false;
  return isTutorAllocatedToLearner(actor.userId, learnerId);
}

/**
 * PearlLMS Phase-10 HP/SW-1 — who may read a learner's per-unit progress: the learner THEMSELF, an
 * Admin/Manager, or that learner's allocated Tutor. Composes isAllocatedTutor + role — no local role logic at
 * the call site. Closes the stock `GET /course/:courseId/progress?profileId` IDOR (any enrolled learner could
 * read a classmate's grades). Learner self-progress otherwise flows through the self-only `/learner-progress`.
 */
export async function canReadLearnerProgress(actor: Actor, learnerId: string): Promise<boolean> {
  if (!actor.authenticated || !learnerId) return false;
  if (actor.userId === learnerId) return true; // self
  if (actor.role === 'ADMIN' || actor.role === 'MANAGER') return true;
  return isAllocatedTutor(actor, learnerId);
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

// ── Sequential unlock (PearlLMS Phase 4) ─────────────────────────────────────────────────────────
/** The learner-facing lock refusal message (docs/UNLOCK-MODEL.md §4 refusal style — 403 via forbidden/AppError). */
const LOCKED_MESSAGE = 'This session is locked — complete the previous session first';

/**
 * Is this unit unlocked for this LEARNER? The ONE gating authority — every enforcement point calls this,
 * never re-implements the walk. Computed LIVE (no stored lock bit) per docs/UNLOCK-MODEL.md §1: toggle off
 * → open; exempt unit → open; otherwise gate on the nearest preceding NON-exempt unit's passing result
 * (Phase-3 `hasLearnerPassedUnit`); no preceding non-exempt unit → open. Applies to LEARNERS only — callers
 * must not consult it for staff (staff are never gated).
 */
export async function isUnitUnlocked(courseId: string, lessonId: string, learnerId: string): Promise<boolean> {
  if (!(await getCourseSequentialUnlock(courseId))) return true;

  const units = await getOrderedUnitsForCourse(courseId);
  const idx = units.findIndex((u) => u.lessonId === lessonId);
  if (idx === -1) return true; // unit not in the course's ordering — do not block (defensive)
  if (isExemptUnitType(units[idx].unitType)) return true;

  const predecessor = findGatePredecessorIndex(units, idx);
  if (predecessor === null) return true; // no preceding non-exempt unit — the first gated unit is open
  return hasLearnerPassedUnit(learnerId, units[predecessor].lessonId);
}

/**
 * Route guard for the material-serving READ paths (lesson GET, lesson-language GET). Enforces the
 * content-read rule on the `:courseId` in the path: staff OR an enrolled learner of a PUBLISHED
 * course. Closes gap G2 — the stock lesson read never checked publish state, so a learner enrolled
 * in a still-draft course could read its materials. Runs alongside the legacy courseMemberMiddleware
 * (which keeps program-course backfill); this adds the missing publish gate.
 */
export async function requireCourseContentRead(c: Context, next: Next) {
  const actor = c.get('actor') as Actor | undefined;
  if (!actor?.authenticated) return unauthorized(c);

  const courseId = c.req.param('courseId');
  if (!courseId) return forbidden(c, 'Missing course context');

  if (!(await canReadCourseContent(actor, courseId))) {
    return forbidden(c, 'This content is not available to you');
  }
  // Phase 4: a non-staff learner is additionally gated by sequential unlock on this unit (path lessonId).
  const lessonId = c.req.param('lessonId');
  if (lessonId && !isContentStaff(actor) && !(await isUnitUnlocked(courseId, lessonId, actor.userId))) {
    return forbidden(c, LOCKED_MESSAGE);
  }
  return next();
}

/** Object-key prefix for admin-authored unit materials (mirrors generateMaterialFileKey in core). */
const MATERIALS_KEY_PREFIX = 'materials/';

/**
 * Access decision for the standalone download (presign) endpoints. Closes gap G3 — the stock
 * download signed any caller-supplied key for any authenticated user with no course binding. Rules:
 *  - anonymous/deactivated → 401;
 *  - **no `courseId`** (org-level asset path, e.g. the media library) → staff only (Admin/Tutor/Manager);
 *  - **with `courseId`** → must satisfy the content-read rule (staff, or an enrolled learner of a
 *    published course). A non-staff caller may additionally only sign `materials/…` keys that are a
 *    CURRENT material of that course (present in a lesson's documents/videos) — removed or cross-course
 *    material keys are 403 (this is what makes a deleted material unretrievable). Non-material keys
 *    (e.g. a learner's own exercise-submission file) are gated by the read rule but not the material
 *    currency check — their access model is the coursework subsystem's / Phase 3's concern.
 * Staff bypass the currency check so the authoring upload flow can sign a just-uploaded key.
 * Throws AppError (handled globally); returns normally when access is granted.
 */
export async function assertCourseMaterialDownloadAccess(
  actor: Actor,
  courseId: string | undefined,
  keys: string[]
): Promise<void> {
  if (!actor.authenticated) {
    throw new AppError('Unauthorized', ErrorCodes.UNAUTHORIZED, 401);
  }

  if (!courseId) {
    // Org-level asset download (no course context) — restrict to staff (closes the any-authed-user hole).
    if (!isContentStaff(actor)) {
      throw new AppError('Only staff may download organization assets', ErrorCodes.FORBIDDEN, 403);
    }
    return;
  }

  if (!(await canReadCourseContent(actor, courseId))) {
    throw new AppError('You do not have access to this course’s materials', ErrorCodes.FORBIDDEN, 403);
  }
  if (isContentStaff(actor)) return;

  const materialKeys = keys.filter((key) => key.startsWith(MATERIALS_KEY_PREFIX));
  if (materialKeys.length > 0) {
    const currentKeys = await getCourseMaterialKeys(courseId);
    const allCurrent = materialKeys.every((key) => currentKeys.has(key));
    if (!allCurrent) {
      throw new AppError('One or more materials are not available in this course', ErrorCodes.FORBIDDEN, 403);
    }
    // Phase 4: a locked unit's materials are refused (this path has no lessonId, so resolve each material
    // key → its owning unit → isUnitUnlocked). Non-staff learners only — staff returned above.
    const keyLesson = await getMaterialKeyLessonMap(courseId);
    for (const key of materialKeys) {
      const lessonId = keyLesson.get(key);
      if (lessonId && !(await isUnitUnlocked(courseId, lessonId, actor.userId))) {
        throw new AppError(LOCKED_MESSAGE, ErrorCodes.FORBIDDEN, 403);
      }
    }
  }
}

// ── Coursework access (PearlLMS Phase 3 Step 4) ─────────────────────────────────────────────────
// Coursework submissions are the most sensitive objects in the system: one learner's work must never
// reach another learner. The read set is deliberately narrow — SELF (the learner), the learner's
// ALLOCATED tutor, or an ADMIN. A Manager gets NO coursework (they get states/reports in Phase 5), and
// a tutor NOT allocated to the learner is denied everywhere (list, detail, file). Provider-wide
// allocation (not course-team membership) is the tutor rule, so the stock "any course tutor can grade
// any learner" gap cannot leak in.

/**
 * May this actor read this submission? SELF (own coursework) OR the learner's allocated TUTOR OR
 * ADMIN. Manager and any non-allocated tutor → false. Backs the read + file-download guards.
 */
export async function canReadCoursework(actor: Actor, submission: { learnerId: string }): Promise<boolean> {
  if (!actor.authenticated) return false;
  if (actor.role === 'ADMIN') return true;
  if (isSelf(actor, submission.learnerId)) return true;
  if (actor.role === 'TUTOR') return isAllocatedTutor(actor, submission.learnerId);
  return false;
}

/**
 * Submit-coursework guard for `POST …/lesson/:lessonId/coursework(/presign)`. Only an ENROLLED
 * LEARNER of a PUBLISHED course may submit — self is implicit (the learnerId is always the actor's own
 * user id, never taken from input). Staff/Manager do not submit; a draft (unpublished) course is not
 * submittable; a learner not enrolled in the course is denied. Finally (Step 5), once the unit has been
 * PASSED, upload is closed for that unit (the only unit-level close — no cross-session gating). This is
 * the sole write door.
 */
export async function requireCourseworkSubmit(c: Context, next: Next) {
  const actor = c.get('actor') as Actor | undefined;
  if (!actor?.authenticated) return unauthorized(c);

  const courseId = c.req.param('courseId');
  const lessonId = c.req.param('lessonId');
  if (!courseId || !lessonId) return forbidden(c, 'Missing course context');

  if (actor.role !== 'LEARNER') return forbidden(c, 'Only enrolled learners can submit coursework');
  if (!(await isEnrolledLearner(actor, courseId))) return forbidden(c, 'You are not enrolled in this course');
  if (!(await isCoursePublished(courseId))) {
    return forbidden(c, 'This course is not open for coursework submission');
  }
  if (await isUnitUploadClosed(actor.userId, lessonId)) {
    return forbidden(c, 'You have passed this unit — no further submissions are needed');
  }
  // Phase 4: a locked unit refuses submissions too (same isUnitUnlocked gate as content read).
  if (!(await isUnitUnlocked(courseId, lessonId, actor.userId))) {
    return forbidden(c, LOCKED_MESSAGE);
  }
  return next();
}

/**
 * Access decision for signing coursework file downloads. Each requested key must belong to a REAL
 * coursework submission (authoritative jsonb lookup — a guessed/nonexistent key is denied), AND the
 * actor must be permitted to read that submission (canReadCoursework). A single bad key fails the whole
 * request. This is the ONLY door to coursework bytes — raw bucket access is already denied (private
 * bucket, no public URL), and knowing a key never bypasses this guard. Throws AppError (handled
 * globally); returns normally when every key is permitted.
 */
export async function assertCourseworkDownloadAccess(actor: Actor, keys: string[]): Promise<void> {
  if (!actor.authenticated) {
    throw new AppError('Unauthorized', ErrorCodes.UNAUTHORIZED, 401);
  }
  if (keys.length === 0) {
    throw new AppError('No files requested', ErrorCodes.VALIDATION_ERROR, 400);
  }

  for (const key of keys) {
    const submission = await getSubmissionByFileKey(key);
    if (!submission || !(await canReadCoursework(actor, submission))) {
      // 403 (not 404) whether the key is unknown or simply not the caller's — never reveal which.
      throw new AppError('You do not have access to this coursework file', ErrorCodes.FORBIDDEN, 403);
    }
  }
}
