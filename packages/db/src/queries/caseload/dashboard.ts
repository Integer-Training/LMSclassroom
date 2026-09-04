import * as schema from '@db/schema';

import { and, db, desc, eq, inArray, sql, type DbOrTxClient } from '@db/drizzle';

// PearlLMS Phase 9 — roster-scoped tutor-dashboard aggregates. Every query takes the tutor's ALLOCATED
// learner-id set (from tutor_allocation, resolved by the caller) and never widens it, so a tutor's
// dashboard only ever reflects their own caseload. Admins pass the org-wide allocated set.

export interface RosterCourse {
  courseId: string;
  title: string;
  learners: number;
}

/**
 * Distinct courses the roster is enrolled in (groupmember.roleId = STUDENT), with the per-course count of
 * THOSE learners (roster-scoped, not the whole cohort). Ordered by learner count desc. Empty roster → [].
 */
export async function getCoursesForLearners(
  learnerIds: string[],
  client: DbOrTxClient = db
): Promise<RosterCourse[]> {
  if (learnerIds.length === 0) return [];
  const rows = await client
    .select({
      courseId: schema.course.id,
      title: schema.course.title,
      learners: sql<number>`count(distinct ${schema.groupmember.profileId})`
    })
    .from(schema.groupmember)
    .innerJoin(schema.group, eq(schema.group.id, schema.groupmember.groupId))
    .innerJoin(schema.course, eq(schema.course.groupId, schema.group.id))
    .where(and(inArray(schema.groupmember.profileId, learnerIds), eq(schema.groupmember.roleId, 3)))
    .groupBy(schema.course.id, schema.course.title)
    .orderBy(desc(sql`count(distinct ${schema.groupmember.profileId})`));
  return rows.map((r) => ({ courseId: r.courseId, title: r.title ?? 'Untitled course', learners: Number(r.learners) }));
}

export interface LearnerEnrolment {
  learnerId: string;
  courseId: string;
  title: string;
  /** The enrolment date (groupmember.createdAt) — earliest across a learner's courses is their start date. */
  enrolledAt: string | null;
}

/**
 * Per-learner course enrolments for a roster (groupmember.roleId = STUDENT), each with the course title and
 * the enrolment date (groupmember.createdAt). One row per (learner, course). Roster-scoped by the caller (an
 * empty set → []). Feeds the progression view's "start date" (earliest enrolment) and primary-course pick
 * (most-recent enrolment).
 */
export async function getEnrolmentsForLearners(
  learnerIds: string[],
  client: DbOrTxClient = db
): Promise<LearnerEnrolment[]> {
  if (learnerIds.length === 0) return [];
  const rows = await client
    .select({
      learnerId: schema.groupmember.profileId,
      courseId: schema.course.id,
      title: schema.course.title,
      enrolledAt: schema.groupmember.createdAt
    })
    .from(schema.groupmember)
    .innerJoin(schema.group, eq(schema.group.id, schema.groupmember.groupId))
    .innerJoin(schema.course, eq(schema.course.groupId, schema.group.id))
    .where(and(inArray(schema.groupmember.profileId, learnerIds), eq(schema.groupmember.roleId, 3)));
  return rows.map((r) => ({
    learnerId: r.learnerId as string,
    courseId: r.courseId,
    title: r.title ?? 'Untitled course',
    enrolledAt: (r.enrolledAt as string | null) ?? null
  }));
}

/** All lesson ids across a set of courses (via course_section) — feeds the assessment-item count. */
export async function getLessonIdsForCourses(courseIds: string[], client: DbOrTxClient = db): Promise<string[]> {
  if (courseIds.length === 0) return [];
  const rows = await client
    .select({ id: schema.lesson.id })
    .from(schema.lesson)
    .innerJoin(schema.courseSection, eq(schema.courseSection.id, schema.lesson.sectionId))
    .where(inArray(schema.courseSection.courseId, courseIds));
  return rows.map((r) => r.id);
}

/** Member status (ACTIVE | DEACTIVATED) for a set of profile ids → Map. Backs the "suspended" activity bucket. */
export async function getProfileStatusForIds(ids: string[], client: DbOrTxClient = db): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  const rows = await client
    .select({ id: schema.profile.id, status: schema.profile.status })
    .from(schema.profile)
    .where(inArray(schema.profile.id, ids));
  for (const r of rows) map.set(r.id, r.status ?? 'ACTIVE');
  return map;
}
