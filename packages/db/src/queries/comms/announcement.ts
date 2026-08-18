import * as schema from '@db/schema';

import { and, db, desc, eq, isNull, or, sql, type DbOrTxClient } from '@db/drizzle';

// PearlLMS Phase 6 Step 5 — announcement queries (docs/COMMS-MODEL.md §4). Visibility scoping is applied
// HERE at the query layer: a learner's feed is provider-wide (course_id NULL) UNION their ENROLLED PUBLISHED
// courses' announcements — an unenrolled learner's query never returns another course's announcement. These
// queries do no role checks; the service enforces poster role + course-membership.

export interface AnnouncementRow {
  id: string;
  organizationId: string;
  authorId: string | null;
  courseId: string | null;
  title: string;
  body: string;
  publishedAt: string;
  createdAt: string;
}

export interface InsertAnnouncementInput {
  organizationId: string;
  authorId: string;
  courseId: string | null;
  title: string;
  body: string;
}

export async function insertAnnouncement(
  input: InsertAnnouncementInput,
  client: DbOrTxClient = db
): Promise<AnnouncementRow> {
  const [row] = await client.insert(schema.announcement).values(input).returning();
  return row as AnnouncementRow;
}

export async function getAnnouncementById(id: string, client: DbOrTxClient = db): Promise<AnnouncementRow | null> {
  const [row] = await client.select().from(schema.announcement).where(eq(schema.announcement.id, id)).limit(1);
  return (row as AnnouncementRow) ?? null;
}

/** The learner's own feed: provider-wide (course_id NULL) + the learner's ENROLLED PUBLISHED courses, newest first. */
export async function listAnnouncementsForLearner(
  organizationId: string,
  learnerId: string,
  client: DbOrTxClient = db
): Promise<AnnouncementRow[]> {
  // Enrolled published course ids for this learner (groupmember role STUDENT → course; course.is_published).
  const enrolled = client
    .select({ courseId: schema.course.id })
    .from(schema.groupmember)
    .innerJoin(schema.group, eq(schema.group.id, schema.groupmember.groupId))
    .innerJoin(schema.course, eq(schema.course.groupId, schema.group.id))
    .where(
      and(
        eq(schema.groupmember.profileId, learnerId),
        eq(schema.groupmember.roleId, 3),
        eq(schema.course.isPublished, true)
      )
    );

  const rows = await client
    .select()
    .from(schema.announcement)
    .where(
      and(
        eq(schema.announcement.organizationId, organizationId),
        or(isNull(schema.announcement.courseId), sql`${schema.announcement.courseId} in ${enrolled}`)
      )
    )
    .orderBy(desc(schema.announcement.publishedAt));
  return rows as AnnouncementRow[];
}

/** Every announcement in an org (staff feed / manage list), newest first. */
export async function listAnnouncementsForOrg(
  organizationId: string,
  client: DbOrTxClient = db
): Promise<AnnouncementRow[]> {
  const rows = await client
    .select()
    .from(schema.announcement)
    .where(eq(schema.announcement.organizationId, organizationId))
    .orderBy(desc(schema.announcement.publishedAt));
  return rows as AnnouncementRow[];
}

/** A single course's announcements (its course surface), newest first. */
export async function listAnnouncementsForCourse(
  courseId: string,
  client: DbOrTxClient = db
): Promise<AnnouncementRow[]> {
  const rows = await client
    .select()
    .from(schema.announcement)
    .where(eq(schema.announcement.courseId, courseId))
    .orderBy(desc(schema.announcement.publishedAt));
  return rows as AnnouncementRow[];
}

/** Recipient resolution — enrolled STUDENT ids for a course (course-scoped notification, at publish time). */
export async function getEnrolledLearnerIds(courseId: string, client: DbOrTxClient = db): Promise<string[]> {
  const rows = await client
    .selectDistinct({ profileId: schema.groupmember.profileId })
    .from(schema.groupmember)
    .innerJoin(schema.group, eq(schema.group.id, schema.groupmember.groupId))
    .innerJoin(schema.course, eq(schema.course.groupId, schema.group.id))
    .where(
      and(
        eq(schema.course.id, courseId),
        eq(schema.groupmember.roleId, 3),
        sql`${schema.groupmember.profileId} is not null`
      )
    );
  return rows.map((r) => r.profileId).filter((id): id is string => !!id);
}

/** Recipient resolution — all STUDENT profile ids in an org (provider-wide notification). */
export async function getOrgLearnerIds(organizationId: string, client: DbOrTxClient = db): Promise<string[]> {
  const rows = await client
    .selectDistinct({ profileId: schema.organizationmember.profileId })
    .from(schema.organizationmember)
    .where(
      and(
        eq(schema.organizationmember.organizationId, organizationId),
        eq(schema.organizationmember.roleId, 3),
        sql`${schema.organizationmember.profileId} is not null`
      )
    );
  return rows.map((r) => r.profileId).filter((id): id is string => !!id);
}
