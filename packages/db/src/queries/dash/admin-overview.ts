import * as schema from '@db/schema';

import { and, db, desc, eq, gte, inArray, isNull, sql, type DbOrTxClient } from '@db/drizzle';

// PearlLMS admin dashboard — org-wide aggregate reads. CRITICAL: these are scoped by the org member set
// (organizationmember roleId) and the course→group.organizationId join, NOT by tutor_allocation — so they
// cover EVERY learner/course in the org, not just allocated ones. Read-only; no PII beyond names/emails the
// admin already sees. Roles: ADMIN=1, TUTOR=2, STUDENT=3, MANAGER=4.

const ROLE_STUDENT = 3;
const ROLE_TUTOR = 2;
const asInt = sql<number>`cast(count(*) as int)`;

export interface OrgMemberRosterRow {
  learnerId: string;
  name: string | null;
  email: string | null;
  status: string;
}

/** Every STUDENT org member (id + name + email + status) — the org-wide learner roster. */
export async function listOrgLearners(orgId: string, client: DbOrTxClient = db): Promise<OrgMemberRosterRow[]> {
  const rows = await client
    .selectDistinct({
      learnerId: schema.profile.id,
      name: schema.profile.fullname,
      email: schema.profile.email,
      status: schema.profile.status
    })
    .from(schema.organizationmember)
    .innerJoin(schema.profile, eq(schema.profile.id, schema.organizationmember.profileId))
    .where(and(eq(schema.organizationmember.organizationId, orgId), eq(schema.organizationmember.roleId, ROLE_STUDENT)))
    .orderBy(schema.profile.fullname);
  return rows as OrgMemberRosterRow[];
}

/** Every TUTOR org member (id + name + email). */
export async function listOrgTutorMembers(orgId: string, client: DbOrTxClient = db) {
  return client
    .selectDistinct({ tutorId: schema.profile.id, name: schema.profile.fullname, email: schema.profile.email })
    .from(schema.organizationmember)
    .innerJoin(schema.profile, eq(schema.profile.id, schema.organizationmember.profileId))
    .where(and(eq(schema.organizationmember.organizationId, orgId), eq(schema.organizationmember.roleId, ROLE_TUTOR)))
    .orderBy(schema.profile.fullname);
}

export interface RoleStatusCount {
  roleId: number;
  status: string;
  count: number;
}

/** Member counts grouped by role × profile status — one query behind the headline role/status tiles. */
export async function getMemberRoleStatusCounts(orgId: string, client: DbOrTxClient = db): Promise<RoleStatusCount[]> {
  const rows = await client
    .select({ roleId: schema.organizationmember.roleId, status: schema.profile.status, count: asInt })
    .from(schema.organizationmember)
    .innerJoin(schema.profile, eq(schema.profile.id, schema.organizationmember.profileId))
    .where(eq(schema.organizationmember.organizationId, orgId))
    .groupBy(schema.organizationmember.roleId, schema.profile.status);
  return rows.map((r) => ({ roleId: Number(r.roleId), status: r.status, count: Number(r.count) }));
}

/** Count of PUBLISHED courses in the org. */
export async function getPublishedCourseCount(orgId: string, client: DbOrTxClient = db): Promise<number> {
  const [row] = await client
    .select({ count: asInt })
    .from(schema.course)
    .innerJoin(schema.group, eq(schema.group.id, schema.course.groupId))
    .where(and(eq(schema.group.organizationId, orgId), eq(schema.course.isPublished, true)));
  return Number(row?.count ?? 0);
}

/** Published vs draft course counts for the org (one grouped query). */
export async function getCourseCounts(
  orgId: string,
  client: DbOrTxClient = db
): Promise<{ published: number; draft: number }> {
  const rows = await client
    .select({ isPublished: schema.course.isPublished, count: asInt })
    .from(schema.course)
    .innerJoin(schema.group, eq(schema.group.id, schema.course.groupId))
    .where(eq(schema.group.organizationId, orgId))
    .groupBy(schema.course.isPublished);
  let published = 0;
  let draft = 0;
  for (const r of rows) {
    if (r.isPublished) published += Number(r.count);
    else draft += Number(r.count);
  }
  return { published, draft };
}

export interface MonthCount {
  month: number; // 1-12
  count: number;
}

/** New enrolments (groupmember STUDENT) per calendar month for a year — the enrolment-trend bar chart. */
export async function getEnrollmentTrend(
  orgId: string,
  year: number,
  client: DbOrTxClient = db
): Promise<MonthCount[]> {
  const rows = await client
    .select({ month: sql<number>`cast(extract(month from ${schema.groupmember.createdAt}) as int)`, count: asInt })
    .from(schema.groupmember)
    .innerJoin(schema.group, eq(schema.group.id, schema.groupmember.groupId))
    .where(
      and(
        eq(schema.group.organizationId, orgId),
        eq(schema.groupmember.roleId, ROLE_STUDENT),
        sql`extract(year from ${schema.groupmember.createdAt}) = ${year}`
      )
    )
    .groupBy(sql`extract(month from ${schema.groupmember.createdAt})`);
  return fillMonths(rows.map((r) => ({ month: Number(r.month), count: Number(r.count) })));
}

/** Coursework submissions per calendar month for a year — the submissions-over-time chart. */
export async function getSubmissionsOverTime(
  orgId: string,
  year: number,
  client: DbOrTxClient = db
): Promise<MonthCount[]> {
  const rows = await client
    .select({
      month: sql<number>`cast(extract(month from ${schema.courseworkSubmission.submittedAt}) as int)`,
      count: asInt
    })
    .from(schema.courseworkSubmission)
    .innerJoin(schema.course, eq(schema.course.id, schema.courseworkSubmission.courseId))
    .innerJoin(schema.group, eq(schema.group.id, schema.course.groupId))
    .where(
      and(
        eq(schema.group.organizationId, orgId),
        sql`extract(year from ${schema.courseworkSubmission.submittedAt}) = ${year}`
      )
    )
    .groupBy(sql`extract(month from ${schema.courseworkSubmission.submittedAt})`);
  return fillMonths(rows.map((r) => ({ month: Number(r.month), count: Number(r.count) })));
}

/** Org-wide study seconds per 'YYYY-MM', all learners summed — the study-hours area chart source. */
export async function getOrgStudyHoursMonthly(
  orgId: string,
  year: number,
  client: DbOrTxClient = db
): Promise<{ yearMonth: string; seconds: number }[]> {
  const rows = await client
    .select({
      yearMonth: schema.unitTimeMonthly.yearMonth,
      seconds: sql<number>`cast(sum(${schema.unitTimeMonthly.seconds}) as bigint)`
    })
    .from(schema.unitTimeMonthly)
    .innerJoin(
      schema.organizationmember,
      and(
        eq(schema.organizationmember.profileId, schema.unitTimeMonthly.learnerId),
        eq(schema.organizationmember.organizationId, orgId),
        eq(schema.organizationmember.roleId, ROLE_STUDENT)
      )
    )
    .where(sql`${schema.unitTimeMonthly.yearMonth} like ${`${year}-%`}`)
    .groupBy(schema.unitTimeMonthly.yearMonth);
  return rows.map((r) => ({ yearMonth: r.yearMonth, seconds: Number(r.seconds) }));
}

export interface OnlineUserRow {
  userId: string;
  name: string | null;
  email: string | null;
  roleId: number;
  lastActive: string;
}

/** Org members whose session was refreshed within `minutes` — the near-live "Online now" panel. */
export async function getOnlineOrgMembers(
  orgId: string,
  minutes: number,
  client: DbOrTxClient = db
): Promise<OnlineUserRow[]> {
  const cutoff = new Date(Date.now() - minutes * 60_000).toISOString();
  const rows = await client
    .select({
      userId: schema.profile.id,
      name: schema.profile.fullname,
      email: schema.profile.email,
      roleId: schema.organizationmember.roleId,
      lastActive: sql<string>`max(${schema.session.updatedAt})`
    })
    .from(schema.session)
    .innerJoin(schema.profile, eq(schema.profile.id, schema.session.userId))
    .innerJoin(schema.organizationmember, eq(schema.organizationmember.profileId, schema.profile.id))
    .where(
      and(eq(schema.organizationmember.organizationId, orgId), gte(schema.session.updatedAt, sql`${cutoff}::timestamp`))
    )
    .groupBy(schema.profile.id, schema.profile.fullname, schema.profile.email, schema.organizationmember.roleId)
    .orderBy(desc(sql`max(${schema.session.updatedAt})`));
  return rows.map((r) => ({ ...r, roleId: Number(r.roleId) })) as OnlineUserRow[];
}

export interface StatusCount {
  status: string;
  count: number;
}

/** Registration/onboarding funnel — count per status (pending | approved | rejected). */
export async function getRegistrationFunnel(orgId: string, client: DbOrTxClient = db): Promise<StatusCount[]> {
  const rows = await client
    .select({ status: schema.registration.status, count: asInt })
    .from(schema.registration)
    .where(eq(schema.registration.organizationId, orgId))
    .groupBy(schema.registration.status);
  return rows.map((r) => ({ status: r.status, count: Number(r.count) }));
}

/** ID-verification status breakdown across the org's learners (only learners with a row are counted). */
export async function getIdVerificationBreakdown(orgId: string, client: DbOrTxClient = db): Promise<StatusCount[]> {
  const rows = await client
    .select({ status: schema.idVerification.status, count: asInt })
    .from(schema.idVerification)
    .innerJoin(
      schema.organizationmember,
      and(
        eq(schema.organizationmember.profileId, schema.idVerification.learnerId),
        eq(schema.organizationmember.organizationId, orgId),
        eq(schema.organizationmember.roleId, ROLE_STUDENT)
      )
    )
    .groupBy(schema.idVerification.status);
  return rows.map((r) => ({ status: r.status, count: Number(r.count) }));
}

/** Org messaging load — total threads, active (non-archived) threads, messages in the last 7 days. */
export async function getOrgMessagingStats(
  orgId: string,
  client: DbOrTxClient = db
): Promise<{ totalThreads: number; activeThreads: number; messagesLast7d: number }> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [threads, messages] = await Promise.all([
    client
      .select({
        total: asInt,
        active: sql<number>`cast(count(*) filter (where ${schema.messageThread.archivedAt} is null) as int)`
      })
      .from(schema.messageThread)
      .where(eq(schema.messageThread.organizationId, orgId)),
    client
      .select({ count: asInt })
      .from(schema.message)
      .innerJoin(schema.messageThread, eq(schema.messageThread.id, schema.message.threadId))
      .where(
        and(
          eq(schema.messageThread.organizationId, orgId),
          gte(schema.message.createdAt, sql`${sevenDaysAgo}::timestamp`)
        )
      )
  ]);
  return {
    totalThreads: Number(threads[0]?.total ?? 0),
    activeThreads: Number(threads[0]?.active ?? 0),
    messagesLast7d: Number(messages[0]?.count ?? 0)
  };
}

/** Count of live (non-archived, non-deleted) broadcasts in the org. */
export async function getActiveBroadcastCount(orgId: string, client: DbOrTxClient = db): Promise<number> {
  const [row] = await client
    .select({ count: asInt })
    .from(schema.announcement)
    .where(
      and(
        eq(schema.announcement.organizationId, orgId),
        isNull(schema.announcement.archivedAt),
        isNull(schema.announcement.deletedAt)
      )
    );
  return Number(row?.count ?? 0);
}

export interface OrgCourseRow {
  courseId: string;
  title: string;
  isPublished: boolean;
  enrolled: number;
}

/** Every course in the org with its enrolled STUDENT count — the base of the Course Overview table. */
export async function getOrgCoursesWithEnrolment(orgId: string, client: DbOrTxClient = db): Promise<OrgCourseRow[]> {
  const rows = await client
    .select({
      courseId: schema.course.id,
      title: schema.course.title,
      isPublished: schema.course.isPublished,
      enrolled: sql<number>`cast(count(distinct ${schema.groupmember.profileId}) filter (where ${schema.groupmember.roleId} = ${ROLE_STUDENT}) as int)`
    })
    .from(schema.course)
    .innerJoin(schema.group, eq(schema.group.id, schema.course.groupId))
    .leftJoin(schema.groupmember, eq(schema.groupmember.groupId, schema.group.id))
    .where(eq(schema.group.organizationId, orgId))
    .groupBy(schema.course.id, schema.course.title, schema.course.isPublished)
    .orderBy(desc(sql`count(distinct ${schema.groupmember.profileId})`));
  return rows.map((r) => ({ ...r, isPublished: !!r.isPublished, enrolled: Number(r.enrolled) })) as OrgCourseRow[];
}

/** Enrolled STUDENT ids per course (org-scoped) — feeds per-course active-in-30d via a last-seen map. */
export async function getCourseEnrolledLearnerIds(
  orgId: string,
  client: DbOrTxClient = db
): Promise<{ courseId: string; learnerId: string }[]> {
  const rows = await client
    .selectDistinct({ courseId: schema.course.id, learnerId: schema.groupmember.profileId })
    .from(schema.course)
    .innerJoin(schema.group, eq(schema.group.id, schema.course.groupId))
    .innerJoin(
      schema.groupmember,
      and(eq(schema.groupmember.groupId, schema.group.id), eq(schema.groupmember.roleId, ROLE_STUDENT))
    )
    .where(and(eq(schema.group.organizationId, orgId), sql`${schema.groupmember.profileId} is not null`));
  return rows.filter((r) => !!r.learnerId).map((r) => ({ courseId: r.courseId, learnerId: r.learnerId as string }));
}

/** lesson→course pairs for a set of courses (lesson ⨝ course_section) — for per-course assessment counts. */
export async function getLessonCoursePairs(
  courseIds: string[],
  client: DbOrTxClient = db
): Promise<{ lessonId: string; courseId: string }[]> {
  if (courseIds.length === 0) return [];
  const rows = await client
    .select({ lessonId: schema.lesson.id, courseId: schema.courseSection.courseId })
    .from(schema.lesson)
    .innerJoin(schema.courseSection, eq(schema.courseSection.id, schema.lesson.sectionId))
    .where(inArray(schema.courseSection.courseId, courseIds));
  return rows.filter((r): r is { lessonId: string; courseId: string } => !!r.courseId);
}

/** Fill a sparse month list (1-12) with zeros so charts always have 12 points. */
function fillMonths(rows: MonthCount[]): MonthCount[] {
  const map = new Map(rows.map((r) => [r.month, r.count]));
  return Array.from({ length: 12 }, (_, i) => ({ month: i + 1, count: map.get(i + 1) ?? 0 }));
}
