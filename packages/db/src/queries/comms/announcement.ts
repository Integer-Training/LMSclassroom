import * as schema from '@db/schema';

import { and, db, desc, eq, inArray, isNull, or, sql, type DbOrTxClient } from '@db/drizzle';

// PearlLMS Phase 6 Step 5 + broadcast extension — announcement queries (docs/COMMS-MODEL.md §4). Visibility
// scoping is applied HERE at the query layer, off `audience_type`: a learner sees all_learners + their ENROLLED
// courses' + broadcasts targeted at them directly + broadcasts to their allocated tutor's group; a tutor sees
// all_tutors + broadcasts targeted at them. Archived/soft-deleted rows never reach a recipient feed. These
// queries do no role checks; the service enforces poster role + target validity.

export type AnnouncementAudience = 'all_learners' | 'all_tutors' | 'course' | 'learner' | 'tutor';

export interface AnnouncementRow {
  id: string;
  organizationId: string;
  authorId: string | null;
  courseId: string | null;
  audienceType: string;
  targetUserId: string | null;
  title: string;
  body: string;
  publishedAt: string;
  createdAt: string;
  archivedAt: string | null;
  deletedAt: string | null;
}

export interface InsertAnnouncementInput {
  organizationId: string;
  authorId: string;
  audienceType: AnnouncementAudience;
  courseId: string | null;
  targetUserId: string | null;
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

/**
 * The learner's own feed (not archived, not deleted), newest first. Includes:
 *  - all_learners (org-wide)
 *  - course: the learner's ENROLLED PUBLISHED courses
 *  - learner: targeted at this learner directly
 *  - tutor: targeted at a tutor this learner is allocated to (i.e. "this tutor's learners")
 */
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

  // The tutors this learner is allocated to (for the `tutor` audience — "learners under a tutor").
  const myTutors = client
    .select({ tutorId: schema.tutorAllocation.tutorId })
    .from(schema.tutorAllocation)
    .where(eq(schema.tutorAllocation.learnerId, learnerId));

  const rows = await client
    .select()
    .from(schema.announcement)
    .where(
      and(
        eq(schema.announcement.organizationId, organizationId),
        isNull(schema.announcement.archivedAt),
        isNull(schema.announcement.deletedAt),
        or(
          eq(schema.announcement.audienceType, 'all_learners'),
          and(eq(schema.announcement.audienceType, 'course'), sql`${schema.announcement.courseId} in ${enrolled}`),
          and(eq(schema.announcement.audienceType, 'learner'), eq(schema.announcement.targetUserId, learnerId)),
          and(eq(schema.announcement.audienceType, 'tutor'), sql`${schema.announcement.targetUserId} in ${myTutors}`)
        )
      )
    )
    .orderBy(desc(schema.announcement.publishedAt));
  return rows as AnnouncementRow[];
}

/**
 * A tutor's feed (not archived, not deleted), newest first: broadcasts to all_tutors, plus any targeted at
 * this tutor specifically. Deliberately NOT the learner-facing broadcasts sent to their caseload.
 */
export async function listAnnouncementsForTutor(
  organizationId: string,
  tutorId: string,
  client: DbOrTxClient = db
): Promise<AnnouncementRow[]> {
  const rows = await client
    .select()
    .from(schema.announcement)
    .where(
      and(
        eq(schema.announcement.organizationId, organizationId),
        isNull(schema.announcement.archivedAt),
        isNull(schema.announcement.deletedAt),
        or(
          eq(schema.announcement.audienceType, 'all_tutors'),
          and(eq(schema.announcement.audienceType, 'tutor'), eq(schema.announcement.targetUserId, tutorId))
        )
      )
    )
    .orderBy(desc(schema.announcement.publishedAt));
  return rows as AnnouncementRow[];
}

/** Every non-deleted announcement in an org (admin manage list — archived rows INCLUDED, flagged), newest first. */
export async function listAnnouncementsForOrg(
  organizationId: string,
  client: DbOrTxClient = db
): Promise<AnnouncementRow[]> {
  const rows = await client
    .select()
    .from(schema.announcement)
    .where(and(eq(schema.announcement.organizationId, organizationId), isNull(schema.announcement.deletedAt)))
    .orderBy(desc(schema.announcement.publishedAt));
  return rows as AnnouncementRow[];
}

/** A single course's live announcements (its course surface), newest first. */
export async function listAnnouncementsForCourse(
  courseId: string,
  client: DbOrTxClient = db
): Promise<AnnouncementRow[]> {
  const rows = await client
    .select()
    .from(schema.announcement)
    .where(
      and(
        eq(schema.announcement.courseId, courseId),
        eq(schema.announcement.audienceType, 'course'),
        isNull(schema.announcement.archivedAt),
        isNull(schema.announcement.deletedAt)
      )
    )
    .orderBy(desc(schema.announcement.publishedAt));
  return rows as AnnouncementRow[];
}

/** Set (or clear) archived_at on an announcement scoped to an org. Returns the updated row or null. */
export async function setAnnouncementArchived(
  id: string,
  organizationId: string,
  archived: boolean,
  client: DbOrTxClient = db
): Promise<AnnouncementRow | null> {
  const [row] = await client
    .update(schema.announcement)
    .set({ archivedAt: archived ? sql`now()` : null })
    .where(
      and(
        eq(schema.announcement.id, id),
        eq(schema.announcement.organizationId, organizationId),
        isNull(schema.announcement.deletedAt)
      )
    )
    .returning();
  return (row as AnnouncementRow) ?? null;
}

/** Soft-delete an announcement scoped to an org (sets deleted_at). Returns the updated row or null. */
export async function softDeleteAnnouncement(
  id: string,
  organizationId: string,
  client: DbOrTxClient = db
): Promise<AnnouncementRow | null> {
  const [row] = await client
    .update(schema.announcement)
    .set({ deletedAt: sql`now()` })
    .where(
      and(
        eq(schema.announcement.id, id),
        eq(schema.announcement.organizationId, organizationId),
        isNull(schema.announcement.deletedAt)
      )
    )
    .returning();
  return (row as AnnouncementRow) ?? null;
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

/** Recipient resolution — all STUDENT profile ids in an org (all_learners broadcast). */
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

/** Recipient resolution — all TUTOR profile ids in an org (all_tutors broadcast). */
export async function getOrgTutorIds(organizationId: string, client: DbOrTxClient = db): Promise<string[]> {
  const rows = await client
    .selectDistinct({ profileId: schema.organizationmember.profileId })
    .from(schema.organizationmember)
    .where(
      and(
        eq(schema.organizationmember.organizationId, organizationId),
        eq(schema.organizationmember.roleId, 2),
        sql`${schema.organizationmember.profileId} is not null`
      )
    );
  return rows.map((r) => r.profileId).filter((id): id is string => !!id);
}

export interface OrgTutorOption {
  id: string;
  name: string | null;
  email: string | null;
}

/** The org's tutors (id + display name + email) for the broadcast audience picker. Ordered by name. */
export async function listOrgTutors(organizationId: string, client: DbOrTxClient = db): Promise<OrgTutorOption[]> {
  const rows = await client
    .selectDistinct({
      id: schema.profile.id,
      name: schema.profile.fullname,
      email: schema.profile.email
    })
    .from(schema.organizationmember)
    .innerJoin(schema.profile, eq(schema.profile.id, schema.organizationmember.profileId))
    .where(and(eq(schema.organizationmember.organizationId, organizationId), eq(schema.organizationmember.roleId, 2)))
    .orderBy(schema.profile.fullname);
  return rows as OrgTutorOption[];
}

/** Display names for a set of profile ids (admin manage list enrichment). Empty in → empty out. */
export async function getProfileNamesByIds(
  ids: string[],
  client: DbOrTxClient = db
): Promise<{ id: string; name: string | null }[]> {
  if (ids.length === 0) return [];
  const rows = await client
    .select({ id: schema.profile.id, name: schema.profile.fullname })
    .from(schema.profile)
    .where(inArray(schema.profile.id, ids));
  return rows;
}

/** Titles for a set of course ids (admin manage list enrichment). Empty in → empty out. */
export async function getCourseTitlesByIds(
  ids: string[],
  client: DbOrTxClient = db
): Promise<{ id: string; title: string | null }[]> {
  if (ids.length === 0) return [];
  const rows = await client
    .select({ id: schema.course.id, title: schema.course.title })
    .from(schema.course)
    .where(inArray(schema.course.id, ids));
  return rows;
}
