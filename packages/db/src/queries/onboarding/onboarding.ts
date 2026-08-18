import * as schema from '@db/schema';

import { and, db, eq, type DbOrTxClient } from '@db/drizzle';

// PearlLMS Phase 5 Step 5 — lookups for lite learner onboarding (docs/PROGRESS-MODEL.md §6). Read-only:
// the published-course picker for the form, and the enrolment-target resolver that binds a chosen course to
// the actor's org and confirms it is publishable/enrolable BEFORE any account is created (so a bad course
// fails before, not after, provisioning).

export interface OnboardingCourse {
  courseId: string;
  title: string | null;
}

export interface OnboardingCourseTarget {
  courseId: string;
  title: string | null;
  orgId: string | null;
  isPublished: boolean;
  groupId: string | null;
}

/** Published courses in an org — the onboarding course selector. Id + title only. */
export async function listPublishedCoursesForOrg(
  orgId: string,
  client: DbOrTxClient = db
): Promise<OnboardingCourse[]> {
  const rows = await client
    .select({ courseId: schema.course.id, title: schema.course.title })
    .from(schema.course)
    .innerJoin(schema.group, eq(schema.group.id, schema.course.groupId))
    .where(and(eq(schema.group.organizationId, orgId), eq(schema.course.isPublished, true)))
    .orderBy(schema.course.title);
  return rows.map((r) => ({ courseId: r.courseId, title: r.title ?? null }));
}

/** Resolve a course's org + published + group, to validate the enrolment target before provisioning. */
export async function getCourseEnrolmentTarget(
  courseId: string,
  client: DbOrTxClient = db
): Promise<OnboardingCourseTarget | null> {
  const [row] = await client
    .select({
      courseId: schema.course.id,
      title: schema.course.title,
      orgId: schema.group.organizationId,
      isPublished: schema.course.isPublished,
      groupId: schema.course.groupId
    })
    .from(schema.course)
    .leftJoin(schema.group, eq(schema.group.id, schema.course.groupId))
    .where(eq(schema.course.id, courseId))
    .limit(1);
  if (!row) return null;
  return {
    courseId: row.courseId,
    title: row.title ?? null,
    orgId: row.orgId ?? null,
    isPublished: row.isPublished ?? false,
    groupId: row.groupId ?? null
  };
}
