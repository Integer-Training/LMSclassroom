import {
  analyticsLoginEvents,
  and,
  asc,
  course,
  dashOrgStats,
  db,
  desc,
  eq,
  gte,
  group,
  groupmember,
  isNotNull,
  lesson,
  lessonCompletion,
  organizationmember,
  profile,
  sql
} from '@db/drizzle';

import { ROLE } from '@cio/utils/constants';

/**
 * The org dashboard's "Top courses" card: the 5 ACTIVE courses with the MOST enrolled students (highest first; ties by
 * title). Decision #2 — this used to list the 5 LEAST-completed courses.
 *
 * Students, lessons and recorded lesson completions are PRE-AGGREGATED per course and then joined 1:1 to the course
 * row (the old single query joined member x lesson x completion, a student*lesson cross product per course). The
 * formulas are unchanged: completion % = completed lesson rows / (students x lessons) over ENROLLED role-3 students
 * only; certification % = certified students / students.
 */
export function getCourseStats(orgId: string) {
  const scope = and(eq(course.status, 'ACTIVE'), eq(group.organizationId, orgId));

  const studentsAgg = db
    .select({
      courseId: course.id,
      totalStudents: sql<number>`COUNT(${groupmember.id})`.as('total_students'),
      certificatesEarned:
        sql<number>`COUNT(${groupmember.id}) FILTER (WHERE ${groupmember.certificateEarnedAt} IS NOT NULL)`.as(
          'certificates_earned'
        )
    })
    .from(course)
    .innerJoin(group, eq(group.id, course.groupId))
    .innerJoin(groupmember, and(eq(groupmember.groupId, group.id), eq(groupmember.roleId, ROLE.STUDENT)))
    .where(scope)
    .groupBy(course.id)
    .as('students_agg');

  const lessonsAgg = db
    .select({
      courseId: course.id,
      totalLessons: sql<number>`COUNT(${lesson.id})`.as('total_lessons')
    })
    .from(course)
    .innerJoin(group, eq(group.id, course.groupId))
    .innerJoin(lesson, eq(lesson.courseId, course.id))
    .where(scope)
    .groupBy(course.id)
    .as('lessons_agg');

  const completionsAgg = db
    .select({
      courseId: course.id,
      completedLessons: sql<number>`COUNT(DISTINCT ${lessonCompletion.id})`.as('completed_lessons')
    })
    .from(course)
    .innerJoin(group, eq(group.id, course.groupId))
    .innerJoin(lesson, eq(lesson.courseId, course.id))
    .innerJoin(groupmember, and(eq(groupmember.groupId, group.id), eq(groupmember.roleId, ROLE.STUDENT)))
    .innerJoin(
      lessonCompletion,
      and(
        eq(lessonCompletion.lessonId, lesson.id),
        eq(lessonCompletion.profileId, groupmember.profileId),
        eq(lessonCompletion.isComplete, true)
      )
    )
    .where(scope)
    .groupBy(course.id)
    .as('completions_agg');

  const students = sql`COALESCE(${studentsAgg.totalStudents}, 0)`;
  const lessons = sql`COALESCE(${lessonsAgg.totalLessons}, 0)`;
  const completed = sql`COALESCE(${completionsAgg.completedLessons}, 0)`;
  const certificates = sql`COALESCE(${studentsAgg.certificatesEarned}, 0)`;

  return db
    .select({
      courseId: course.id,
      courseTitle: course.title,
      totalStudents: sql<number>`${students}::integer`,
      completionPercentage: sql<number>`
        CASE
          WHEN ${students} * ${lessons} = 0 THEN 0
          ELSE ROUND((${completed}::numeric / (${students} * ${lessons})) * 100)::integer
        END
      `,
      certificationPercentage: sql<number>`
        CASE
          WHEN ${students} = 0 THEN 0
          ELSE ROUND((${certificates}::numeric / ${students}) * 100)::integer
        END
      `
    })
    .from(course)
    .innerJoin(group, eq(group.id, course.groupId))
    .leftJoin(studentsAgg, eq(studentsAgg.courseId, course.id))
    .leftJoin(lessonsAgg, eq(lessonsAgg.courseId, course.id))
    .leftJoin(completionsAgg, eq(completionsAgg.courseId, course.id))
    .where(scope)
    .orderBy(desc(students), asc(course.title), asc(course.id))
    .limit(5);
}

export function getRecentEnrollments(orgId: string) {
  return db
    .select({
      profileId: profile.id,
      avatarUrl: profile.avatarUrl,
      fullname: profile.fullname,
      courseId: course.id,
      courseTitle: course.title,
      enrolledAt: groupmember.createdAt
    })
    .from(course)
    .innerJoin(group, eq(group.id, course.groupId))
    .leftJoin(groupmember, and(eq(groupmember.groupId, group.id), eq(groupmember.roleId, 3)))
    .innerJoin(profile, eq(profile.id, groupmember.profileId))
    .where(and(eq(course.status, 'ACTIVE'), eq(group.organizationId, orgId)))
    .groupBy(profile.id, course.id, course.title, groupmember.createdAt)
    .orderBy(desc(groupmember.createdAt))
    .limit(5);
}

/** Count of student enrollments that have earned a certificate (per org, active courses). */
export function getTotalCertificatesIssued(orgId: string) {
  return db
    .select({
      count: sql<number>`count(${groupmember.id})::int`
    })
    .from(groupmember)
    .innerJoin(group, eq(groupmember.groupId, group.id))
    .innerJoin(course, eq(course.groupId, group.id))
    .where(
      and(
        eq(group.organizationId, orgId),
        eq(course.status, 'ACTIVE'),
        eq(groupmember.roleId, 3),
        isNotNull(groupmember.certificateEarnedAt)
      )
    );
}

/** Most recent certificate earners for the org dashboard. */
export function getRecentCertifications(orgId: string) {
  return db
    .select({
      profileId: profile.id,
      avatarUrl: profile.avatarUrl,
      fullname: profile.fullname,
      courseId: course.id,
      courseTitle: course.title,
      earnedAt: groupmember.certificateEarnedAt
    })
    .from(groupmember)
    .innerJoin(group, eq(groupmember.groupId, group.id))
    .innerJoin(course, eq(course.groupId, group.id))
    .innerJoin(profile, eq(profile.id, groupmember.profileId))
    .where(
      and(
        eq(group.organizationId, orgId),
        eq(course.status, 'ACTIVE'),
        eq(groupmember.roleId, 3),
        isNotNull(groupmember.certificateEarnedAt)
      )
    )
    .orderBy(desc(groupmember.certificateEarnedAt))
    .limit(5);
}

export function getDashOrgStats(orgId: string) {
  return db.select().from(dashOrgStats).where(eq(dashOrgStats.orgId, orgId));
}

/**
 * Returns login counts grouped by day-of-week (0 = Sunday … 6 = Saturday) for
 * students of the given organization over the last `days` days.
 *
 * Each row in analytics_login_events is already one-per-user-per-day, so the
 * counts represent distinct active students per weekday — the chart shows
 * "most active day," not raw login volume.
 */
export function getOrgStudentLoginsByDayOfWeek(orgId: string, days: number) {
  // PearlLMS Phase-10 HP/SW-9 — `days` is now a BOUND parameter (was sql.raw string-interpolation).
  const since = sql`CURRENT_DATE - ${days}::int`;

  return db
    .select({
      dayOfWeek: sql<number>`EXTRACT(DOW FROM ${analyticsLoginEvents.loggedInDate})::int`.as('day_of_week'),
      count: sql<number>`COUNT(*)::int`.as('count')
    })
    .from(analyticsLoginEvents)
    .innerJoin(organizationmember, eq(organizationmember.profileId, analyticsLoginEvents.userId))
    .where(
      and(
        eq(organizationmember.organizationId, orgId),
        eq(organizationmember.roleId, ROLE.STUDENT),
        gte(analyticsLoginEvents.loggedInDate, since)
      )
    )
    .groupBy(sql`day_of_week`)
    .orderBy(sql`day_of_week`);
}

function getDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

export async function getUserLoginStreak(userId: string) {
  const rows = await db
    .select({
      loggedInDate: analyticsLoginEvents.loggedInDate
    })
    .from(analyticsLoginEvents)
    .where(eq(analyticsLoginEvents.userId, userId))
    .orderBy(desc(analyticsLoginEvents.loggedInDate))
    .limit(90);

  const loggedInDates = new Set(rows.map((row) => row.loggedInDate));
  const cursorDate = new Date();

  if (!loggedInDates.has(getDateKey(cursorDate))) {
    cursorDate.setDate(cursorDate.getDate() - 1);
  }

  let daysActive = 0;
  while (loggedInDates.has(getDateKey(cursorDate))) {
    daysActive += 1;
    cursorDate.setDate(cursorDate.getDate() - 1);
  }

  return { daysActive };
}
