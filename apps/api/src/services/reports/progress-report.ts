import { AppError, ErrorCodes } from '@api/utils/errors';
import type { Actor } from '@cio/db/actor';
import {
  getCourseOrgId,
  getCourseProgressReport,
  listReportableCourses,
  type CourseProgressReport,
  type ReportableCourse
} from '@cio/db/queries/reports';

// PearlLMS Phase 5 Step 4 — provider-wide progress report service. Access is Manager/Admin only (enforced by
// requireManagerOrAdmin at the route). Here we additionally bind every read to the ACTOR's org — a
// Manager/Admin can only ever report on their own org's courses, never a cross-org courseId (single-org
// today; header-proof for multi-org). No profile PII is ever selected (docs/PROGRESS-MODEL.md §5).

function assertAuthed(actor: Actor): asserts actor is Extract<Actor, { authenticated: true }> {
  if (!actor.authenticated) throw new AppError('Unauthorized', ErrorCodes.UNAUTHORIZED, 401);
}

/** Courses in the actor's org, for the report's course filter. */
export async function listOrgReportableCourses(actor: Actor): Promise<ReportableCourse[]> {
  assertAuthed(actor);
  return listReportableCourses(actor.orgId);
}

/** The per-course report, bound to the actor's org (a foreign-org courseId is denied). */
export async function getProviderProgressReport(actor: Actor, courseId: string): Promise<CourseProgressReport> {
  assertAuthed(actor);
  const courseOrgId = await getCourseOrgId(courseId);
  if (!courseOrgId) {
    throw new AppError('Course not found', ErrorCodes.NOT_FOUND, 404);
  }
  if (courseOrgId !== actor.orgId) {
    throw new AppError('You do not have access to this course', ErrorCodes.FORBIDDEN, 403);
  }
  return getCourseProgressReport(courseId);
}
