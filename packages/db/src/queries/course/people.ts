import * as schema from '@db/schema';

import { TGroupmember, TNewGroupmember } from '@db/types';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';

import { ROLE } from '@cio/utils/constants';
import { db, runInTransaction } from '@db/drizzle';

/**
 * Gets all course members (people) for a course
 * Returns members with their profile information
 * @param courseId Course ID
 * @returns Array of course members with profile data
 */
export async function getCourseMembers(courseId: string): Promise<
  Array<
    TGroupmember & {
      profile: {
        id: string;
        fullname: string | null;
        username: string | null;
        avatarUrl: string | null;
        email: string | null;
      } | null;
    }
  >
> {
  try {
    const result = await db
      .select({
        member: schema.groupmember,
        profile: {
          id: schema.profile.id,
          fullname: schema.profile.fullname,
          username: schema.profile.username,
          avatarUrl: schema.profile.avatarUrl,
          email: schema.profile.email
        }
      })
      .from(schema.groupmember)
      .innerJoin(schema.course, eq(schema.course.groupId, schema.groupmember.groupId))
      .leftJoin(schema.profile, eq(schema.groupmember.profileId, schema.profile.id))
      .where(eq(schema.course.id, courseId));

    return result.map((row) => ({
      ...row.member,
      profile: row.profile || null
    }));
  } catch (error) {
    console.error('getCourseMembers error:', error);
    throw new Error(`Failed to get course members: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Gets a course member by ID
 * @param courseId Course ID
 * @param memberId Member ID
 * @returns Course member with profile data or null if not found
 */
export async function getCourseMember(
  courseId: string,
  memberId: string
): Promise<
  | (TGroupmember & {
      profile: {
        id: string;
        fullname: string | null;
        username: string | null;
        avatarUrl: string | null;
        email: string | null;
      } | null;
    })
  | null
> {
  try {
    const result = await db
      .select({
        member: schema.groupmember,
        profile: {
          id: schema.profile.id,
          fullname: schema.profile.fullname,
          username: schema.profile.username,
          avatarUrl: schema.profile.avatarUrl,
          email: schema.profile.email
        }
      })
      .from(schema.groupmember)
      .innerJoin(schema.course, eq(schema.course.groupId, schema.groupmember.groupId))
      .leftJoin(schema.profile, eq(schema.groupmember.profileId, schema.profile.id))
      .where(and(eq(schema.course.id, courseId), eq(schema.groupmember.id, memberId)))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    return {
      ...result[0].member,
      profile: result[0].profile || null
    };
  } catch (error) {
    console.error('getCourseMember error:', error);
    throw new Error(`Failed to get course member: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Gets the group ID for a course
 * @param courseId Course ID
 * @returns Group ID or null if not found
 */
export async function getCourseGroupId(courseId: string): Promise<string | null> {
  try {
    const result = await db
      .select({ groupId: schema.course.groupId })
      .from(schema.course)
      .where(eq(schema.course.id, courseId))
      .limit(1);

    return result.length > 0 ? result[0].groupId : null;
  } catch (error) {
    console.error('getCourseGroupId error:', error);
    throw new Error(`Failed to get course group ID: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Gets teachers (ADMIN or TUTOR role) for a course
 * @param options.courseId Course ID (optional if groupId provided)
 * @param options.groupId Group ID (optional if courseId provided)
 * @param options.limit Optional limit (default: no limit, returns all)
 * @returns Array of teachers with profile data
 */
type TeacherProfile = {
  id: string;
  email: string | null;
  fullname: string | null;
  username: string | null;
  avatarUrl: string | null;
};

export async function getCourseTeachers(options: {
  courseId?: string;
  groupId?: string;
  limit?: number;
}): Promise<Array<TeacherProfile>> {
  const { courseId, groupId, limit } = options;

  if (!courseId && !groupId) {
    throw new Error('Either courseId or groupId must be provided');
  }

  const profileSelect = {
    id: schema.profile.id,
    email: schema.profile.email,
    fullname: schema.profile.fullname,
    username: schema.profile.username,
    avatarUrl: schema.profile.avatarUrl
  };

  const isTeacherRole = or(eq(schema.groupmember.roleId, ROLE.ADMIN), eq(schema.groupmember.roleId, ROLE.TUTOR));

  const baseQuery = db
    .select(profileSelect)
    .from(schema.groupmember)
    .innerJoin(schema.profile, eq(schema.groupmember.profileId, schema.profile.id));

  const query = courseId
    ? baseQuery
        .innerJoin(schema.course, eq(schema.course.groupId, schema.groupmember.groupId))
        .where(and(eq(schema.course.id, courseId), isTeacherRole))
    : baseQuery.where(and(eq(schema.groupmember.groupId, groupId!), isTeacherRole));

  const result = await (limit ? query.limit(limit) : query);

  return result;
}

// ── Course → tutor assignment (PearlLMS) ─────────────────────────────────────────────────────────
// A tutor "teaches" a course = a course-team TUTOR groupmember row (roleId 2) in that course's group.
// Admin assigns/unassigns via the tutor-management surface (and the course People tab). This grants the
// tutor responsibility for that course's learners (grading, progress, caseload) — see isCourseTutorForLearner
// and the extended isAllocatedTutor guard.

export interface TutorCourseRef {
  courseId: string;
  title: string | null;
}

/** Courses in this org that the tutor is a course-team TUTOR of (their taught courses). Ordered by title. */
export async function listTutorCourses(orgId: string, tutorId: string): Promise<TutorCourseRef[]> {
  return db
    .select({ courseId: schema.course.id, title: schema.course.title })
    .from(schema.groupmember)
    .innerJoin(schema.group, eq(schema.group.id, schema.groupmember.groupId))
    .innerJoin(schema.course, eq(schema.course.groupId, schema.group.id))
    .where(
      and(
        eq(schema.groupmember.profileId, tutorId),
        eq(schema.groupmember.roleId, ROLE.TUTOR),
        eq(schema.group.organizationId, orgId)
      )
    )
    .orderBy(schema.course.title);
}

/** Every (tutor → taught course) assignment in an org — one bulk query for the tutor-management table. */
export async function listOrgTutorCourseAssignments(
  orgId: string
): Promise<Array<{ tutorId: string | null; courseId: string; title: string | null }>> {
  return db
    .select({ tutorId: schema.groupmember.profileId, courseId: schema.course.id, title: schema.course.title })
    .from(schema.groupmember)
    .innerJoin(schema.group, eq(schema.group.id, schema.groupmember.groupId))
    .innerJoin(schema.course, eq(schema.course.groupId, schema.group.id))
    .where(and(eq(schema.group.organizationId, orgId), eq(schema.groupmember.roleId, ROLE.TUTOR)));
}

/**
 * Reconcile a tutor's taught-courses to EXACTLY `courseIds` (org-scoped; unknown/other-org ids are ignored).
 * Adds a TUTOR groupmember for newly-selected courses (promoting an existing membership in that course's group
 * to TUTOR to respect the (group, profile) uniqueness), and removes the TUTOR membership for de-selected
 * courses (only TUTOR rows — never a student enrolment). Idempotent; runs in one transaction.
 */
export async function setTutorCourseAssignments(
  orgId: string,
  tutorId: string,
  email: string | null,
  courseIds: string[]
): Promise<{ added: string[]; removed: string[] }> {
  const requested = courseIds.length
    ? await db
        .select({ courseId: schema.course.id, groupId: schema.course.groupId })
        .from(schema.course)
        .innerJoin(schema.group, eq(schema.group.id, schema.course.groupId))
        .where(and(inArray(schema.course.id, courseIds), eq(schema.group.organizationId, orgId)))
    : [];
  const requestedGroupByCourse = new Map(requested.map((r) => [r.courseId, r.groupId]));
  const requestedGroupIds = new Set(requested.map((r) => r.groupId));

  const current = await db
    .select({ courseId: schema.course.id, groupId: schema.group.id, memberId: schema.groupmember.id })
    .from(schema.groupmember)
    .innerJoin(schema.group, eq(schema.group.id, schema.groupmember.groupId))
    .innerJoin(schema.course, eq(schema.course.groupId, schema.group.id))
    .where(
      and(
        eq(schema.groupmember.profileId, tutorId),
        eq(schema.groupmember.roleId, ROLE.TUTOR),
        eq(schema.group.organizationId, orgId)
      )
    );
  const currentGroupIds = new Set(current.map((c) => c.groupId));

  const toAddCourseIds = [...requestedGroupByCourse.keys()].filter(
    (cid) => !currentGroupIds.has(requestedGroupByCourse.get(cid)!)
  );
  const toRemove = current.filter((c) => !requestedGroupIds.has(c.groupId));

  if (toAddCourseIds.length === 0 && toRemove.length === 0) {
    return { added: [], removed: [] };
  }

  await runInTransaction(async (tx) => {
    for (const cid of toAddCourseIds) {
      const groupId = requestedGroupByCourse.get(cid)!;
      const [existing] = await tx
        .select({ id: schema.groupmember.id })
        .from(schema.groupmember)
        .where(and(eq(schema.groupmember.groupId, groupId), eq(schema.groupmember.profileId, tutorId)))
        .limit(1);
      if (existing) {
        await tx.update(schema.groupmember).set({ roleId: ROLE.TUTOR }).where(eq(schema.groupmember.id, existing.id));
      } else {
        await tx
          .insert(schema.groupmember)
          .values({ groupId, profileId: tutorId, roleId: ROLE.TUTOR, email: email ?? undefined });
      }
    }
    if (toRemove.length) {
      await tx.delete(schema.groupmember).where(
        inArray(
          schema.groupmember.id,
          toRemove.map((c) => c.memberId)
        )
      );
    }
  });

  return { added: toAddCourseIds, removed: toRemove.map((c) => c.courseId) };
}

/**
 * Adds a course member (person) to a course
 * @param courseId Course ID
 * @param memberData Member data (profileId, roleId, email)
 * @returns Created member
 */
export async function addCourseMember(
  courseId: string,
  memberData: { profileId?: string; roleId: number; email?: string }
): Promise<TGroupmember> {
  try {
    const groupId = await getCourseGroupId(courseId);
    if (!groupId) {
      throw new Error('Course group not found');
    }

    const [newMember] = await db
      .insert(schema.groupmember)
      .values({
        groupId,
        profileId: memberData.profileId,
        roleId: memberData.roleId,
        email: memberData.email
      })
      .returning();

    if (!newMember) {
      throw new Error('Failed to create course member');
    }

    return newMember;
  } catch (error) {
    console.error('addCourseMember error:', error);
    throw new Error(`Failed to add course member: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Updates a course member
 * @param courseId Course ID
 * @param memberId Member ID
 * @param data Partial member data to update
 * @returns Updated member
 */
export async function updateCourseMember(
  courseId: string,
  memberId: string,
  data: Partial<TGroupmember>
): Promise<TGroupmember | null> {
  try {
    // Verify member belongs to course
    const member = await getCourseMember(courseId, memberId);
    if (!member) {
      return null;
    }

    const [updated] = await db
      .update(schema.groupmember)
      .set(data)
      .where(eq(schema.groupmember.id, memberId))
      .returning();

    return updated || null;
  } catch (error) {
    console.error('updateCourseMember error:', error);
    throw new Error(`Failed to update course member: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Deletes a course member
 * @param courseId Course ID
 * @param memberId Member ID
 * @returns Deleted member or null if not found
 */
export async function deleteCourseMember(courseId: string, memberId: string): Promise<TGroupmember | null> {
  try {
    // Verify member belongs to course
    const member = await getCourseMember(courseId, memberId);
    if (!member) {
      return null;
    }

    const [deleted] = await db.delete(schema.groupmember).where(eq(schema.groupmember.id, memberId)).returning();

    return deleted || null;
  } catch (error) {
    console.error('deleteCourseMember error:', error);
    throw new Error(`Failed to delete course member: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Gets profile data by group member ID
 * @param groupMemberId Group member ID
 * @returns Profile data or null if not found
 */
export async function getProfileByGroupMemberId(groupMemberId: string): Promise<{
  id: string;
  fullname: string | null;
  username: string | null;
  avatarUrl: string | null;
  email: string | null;
} | null> {
  try {
    const result = await db
      .select({
        id: schema.profile.id,
        fullname: schema.profile.fullname,
        username: schema.profile.username,
        avatarUrl: schema.profile.avatarUrl,
        email: schema.profile.email
      })
      .from(schema.groupmember)
      .innerJoin(schema.profile, eq(schema.groupmember.profileId, schema.profile.id))
      .where(eq(schema.groupmember.id, groupMemberId))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    return result[0];
  } catch (error) {
    console.error('getProfileByGroupMemberId error:', error);
    throw new Error(
      `Failed to get profile by group member ID "${groupMemberId}": ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Sets when the learner first met certification threshold for this course membership.
 */
export async function setMemberCertificateEarned(memberId: string, earnedAt: string): Promise<TGroupmember | null> {
  try {
    const [updated] = await db
      .update(schema.groupmember)
      .set({ certificateEarnedAt: earnedAt })
      .where(eq(schema.groupmember.id, memberId))
      .returning();
    return updated ?? null;
  } catch (error) {
    console.error('setMemberCertificateEarned error:', error);
    throw new Error(`Failed to set certificate earned: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Atomically claims the certificate for a member: only succeeds if it was not earned yet.
 * Returns true when this caller won the claim, so concurrent evaluations issue the
 * certificate (and downstream email) exactly once.
 */
export async function claimMemberCertificateEarned(memberId: string, earnedAt: string): Promise<boolean> {
  try {
    const updated = await db
      .update(schema.groupmember)
      .set({ certificateEarnedAt: earnedAt })
      .where(and(eq(schema.groupmember.id, memberId), isNull(schema.groupmember.certificateEarnedAt)))
      .returning({ id: schema.groupmember.id });
    return updated.length > 0;
  } catch (error) {
    console.error('claimMemberCertificateEarned error:', error);
    throw new Error(`Failed to claim certificate earned: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Records that the certification congratulations email was sent.
 */
export async function setMemberCertificationEmailSent(memberId: string, sentAt: string): Promise<TGroupmember | null> {
  try {
    const [updated] = await db
      .update(schema.groupmember)
      .set({ certificationEmailSentAt: sentAt })
      .where(eq(schema.groupmember.id, memberId))
      .returning();
    return updated ?? null;
  } catch (error) {
    console.error('setMemberCertificationEmailSent error:', error);
    throw new Error(
      `Failed to set certification email sent: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}
