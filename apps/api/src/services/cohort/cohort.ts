import { AppError, ErrorCodes } from '@api/utils/errors';
import {
  type TCreateCohort,
  type TUpdateCohort,
  type TAddCourseToCohort,
  type TAddCohortMembers,
  type TUpdateCohortMember,
  type TCreateCohortNewsfeed,
  type TUpdateCohortNewsfeed,
  type TUpdateCohortReaction,
  type TCreateCohortNewsfeedComment
} from '@cio/utils/validation/cohort';
import {
  addCourseToCohort,
  addCohortMember,
  addCohortMembersBulk,
  createCohortWithCreatorMembership,
  createCohortNewsfeed as createCohortNewsfeedQuery,
  createCohortNewsfeedComment as createCohortNewsfeedCommentQuery,
  deleteCohort as deleteCohortQuery,
  deleteCohortNewsfeed as deleteCohortNewsfeedQuery,
  deleteCohortNewsfeedComment as deleteCohortNewsfeedCommentQuery,
  getEnrolledCohortsByProfile,
  getCohortById,
  getCohortMemberByProfileId,
  getExistingCohortMembers,
  getCohortMembers,
  getCohortNewsfeed,
  getCohortNewsfeedById,
  getCohortNewsfeedCommentById,
  getCohortNewsfeedComments,
  getCohortsByOrg,
  getCoursesByCohort,
  getCohortMemberRole,
  isCohortCourse,
  isCohortMember,
  removeCourseFromCohort,
  removeCohortMember,
  updateCohort as updateCohortQuery,
  updateCohortMember as updateCohortMemberQuery,
  updateCohortNewsfeed as updateCohortNewsfeedQuery,
  updateCohortNewsfeedReaction
} from '@cio/db/queries/cohort';
import { getCourseGroupIds } from '@cio/db/queries/course';
import { insertGroupMembersOnConflictDoNothing } from '@cio/db/queries/group';
import { getProfilesByEmails } from '@cio/db/queries/auth';
import {
  getOrgMembersByProfileIds,
  getOrganizationMemberIdByOrgAndProfile,
  insertOrganizationMembersOnConflictDoNothing
} from '@cio/db/queries/organization';
import { ROLE } from '@cio/utils/constants';
import { db } from '@cio/db/drizzle';
import { assertStudentCapacityOrThrow } from '../organization/student-limit';

type CohortMemberEnrollment = {
  profileId: string;
  email: string | null;
  roleId: number;
};

async function enrollCohortStudentsInGroups(
  organizationId: string,
  groupIds: string[],
  members: CohortMemberEnrollment[]
) {
  const studentMembers = members.filter((member) => member.profileId && member.roleId === ROLE.STUDENT);
  const uniqueGroupIds = [...new Set(groupIds)];

  if (studentMembers.length === 0 || uniqueGroupIds.length === 0) {
    return 0;
  }

  const studentProfileIds = studentMembers
    .map((member) => member.profileId)
    .filter((profileId): profileId is string => Boolean(profileId));
  const existingMembers = await getOrgMembersByProfileIds(organizationId, studentProfileIds);
  const existingMemberProfileIds = new Set(existingMembers.map((member) => member.profileId));
  const newStudentProfileIds = new Set(
    studentProfileIds.filter((profileId) => !existingMemberProfileIds.has(profileId))
  );

  await assertStudentCapacityOrThrow(organizationId, newStudentProfileIds.size);

  const organizationMemberRows = studentMembers.map((member) => ({
    organizationId,
    roleId: ROLE.STUDENT,
    profileId: member.profileId,
    email: member.email?.trim() || undefined,
    verified: true
  }));

  const groupMemberRows = uniqueGroupIds.flatMap((groupId) =>
    studentMembers.map((member) => ({
      groupId,
      roleId: ROLE.STUDENT,
      profileId: member.profileId,
      email: member.email?.trim() || undefined
    }))
  );

  await db.transaction(async (tx) => {
    await insertOrganizationMembersOnConflictDoNothing(organizationMemberRows, tx);
    await insertGroupMembersOnConflictDoNothing(groupMemberRows, tx);
  });

  return groupMemberRows.length;
}

// ─── Cohort CRUD ─────────────────────────────────────────────────────────────

export async function createCohort(organizationId: string, profileId: string, data: TCreateCohort) {
  try {
    const description = data.description?.trim() || `A cohort for ${data.name}`;

    return createCohortWithCreatorMembership(
      {
        organizationId,
        createdByProfileId: profileId,
        name: data.name,
        description,
        coverImage: data.coverImage
      },
      profileId
    );
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      error instanceof Error ? error.message : 'Failed to create cohort',
      ErrorCodes.COHORT_CREATE_FAILED,
      500
    );
  }
}

export async function getCohort(cohortId: string) {
  try {
    const cohort = await getCohortById(cohortId);
    if (!cohort) {
      throw new AppError('Cohort not found', ErrorCodes.COHORT_NOT_FOUND, 404);
    }
    return cohort;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      error instanceof Error ? error.message : 'Failed to get cohort',
      ErrorCodes.COHORT_NOT_FOUND,
      500
    );
  }
}

export async function listOrgCohorts(organizationId: string) {
  try {
    return getCohortsByOrg(organizationId);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      error instanceof Error ? error.message : 'Failed to list cohorts',
      ErrorCodes.INTERNAL_ERROR,
      500
    );
  }
}

export async function updateCohort(cohortId: string, data: TUpdateCohort) {
  try {
    const updated = await updateCohortQuery(cohortId, data);
    if (!updated) {
      throw new AppError('Cohort not found', ErrorCodes.COHORT_NOT_FOUND, 404);
    }
    return updated;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      error instanceof Error ? error.message : 'Failed to update cohort',
      ErrorCodes.COHORT_UPDATE_FAILED,
      500
    );
  }
}

export async function deleteCohort(cohortId: string) {
  try {
    const deleted = await deleteCohortQuery(cohortId);
    if (!deleted) {
      throw new AppError('Cohort not found', ErrorCodes.COHORT_NOT_FOUND, 404);
    }
    return deleted;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      error instanceof Error ? error.message : 'Failed to delete cohort',
      ErrorCodes.COHORT_DELETE_FAILED,
      500
    );
  }
}

// ─── Cohort Members ──────────────────────────────────────────────────────────

export async function listCohortMembers(cohortId: string) {
  try {
    return getCohortMembers(cohortId);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      error instanceof Error ? error.message : 'Failed to list cohort members',
      ErrorCodes.INTERNAL_ERROR,
      500
    );
  }
}

/** Members processed per transaction / multi-row INSERT in addCohortMembers. */
const COHORT_ADD_CHUNK = 500;

type CohortAddMemberInput = TAddCohortMembers['members'][number];
type CohortAddCandidate = {
  /** Position in the request, so `added` / `errors` keep the request order. */
  index: number;
  profileId: string | null;
  normalizedEmail: string | null;
  roleId: number;
};
type CohortRow = NonNullable<Awaited<ReturnType<typeof getCohortById>>>;

/**
 * The original one-member path (own transaction, per-member capacity check). Kept as the failure-isolation
 * fallback: if a whole chunk's transaction fails (e.g. the plan's student limit is hit part-way through), the
 * chunk is rolled back and replayed one member at a time so each member gets its own result exactly as before.
 */
async function addCandidateOneByOne(cohort: CohortRow, courseGroupIds: string[], candidate: CohortAddCandidate) {
  const { profileId, normalizedEmail, roleId } = candidate;
  return db.transaction(async (tx) => {
    const member = await addCohortMember(
      { cohortId: cohort.id, profileId, roleId, email: normalizedEmail ?? undefined },
      tx
    );

    if (member && member.roleId === ROLE.STUDENT && member.profileId && courseGroupIds.length > 0) {
      const existingOrgMemberId = await getOrganizationMemberIdByOrgAndProfile(
        cohort.organizationId,
        member.profileId,
        tx
      );
      if (!existingOrgMemberId) {
        await assertStudentCapacityOrThrow(cohort.organizationId, 1, tx);
      }

      await insertOrganizationMembersOnConflictDoNothing(
        [
          {
            organizationId: cohort.organizationId,
            roleId: ROLE.STUDENT,
            profileId: member.profileId,
            email: normalizedEmail ?? undefined,
            verified: true
          }
        ],
        tx
      );

      await insertGroupMembersOnConflictDoNothing(
        courseGroupIds.map((groupId) => ({
          groupId,
          roleId: ROLE.STUDENT,
          profileId: member.profileId,
          email: normalizedEmail ?? undefined
        })),
        tx
      );
    }

    return member;
  });
}

/**
 * Fast path for one chunk: ONE transaction with a multi-row cohort_member INSERT (ON CONFLICT DO NOTHING),
 * one org-member lookup + one capacity check for the chunk's new students, then multi-row org-member and
 * group-member inserts. Candidates that lost a concurrent-add race are reported as "already a member".
 */
async function addCandidateChunk(
  cohort: CohortRow,
  courseGroupIds: string[],
  chunk: CohortAddCandidate[],
  emailByIndex: Map<number, string | undefined>
): Promise<Map<number, unknown>> {
  const outcomes = new Map<number, unknown>();

  await db.transaction(async (tx) => {
    const inserted = await addCohortMembersBulk(
      chunk.map((c) => ({
        cohortId: cohort.id,
        profileId: c.profileId,
        roleId: c.roleId,
        email: c.normalizedEmail ?? undefined
      })),
      tx
    );
    const insertedByProfile = new Map(inserted.filter((m) => m.profileId).map((m) => [m.profileId!, m]));
    const insertedNoProfile = inserted.filter((m) => !m.profileId);

    const students: Array<{ candidate: CohortAddCandidate; profileId: string }> = [];
    let noProfileCursor = 0;
    for (const candidate of chunk) {
      const member = candidate.profileId
        ? insertedByProfile.get(candidate.profileId)
        : insertedNoProfile[noProfileCursor++];
      if (!member) {
        outcomes.set(
          candidate.index,
          new AppError(
            `${emailByIndex.get(candidate.index)} is already a member of this cohort`,
            ErrorCodes.MEMBER_ALREADY_IN_COHORT,
            409
          )
        );
        continue;
      }
      outcomes.set(candidate.index, member);
      if (member.roleId === ROLE.STUDENT && member.profileId && courseGroupIds.length > 0) {
        students.push({ candidate, profileId: member.profileId });
      }
    }

    if (students.length === 0) return;

    const profileIds = students.map((s) => s.profileId);
    const existingOrg = new Set(
      (await getOrgMembersByProfileIds(cohort.organizationId, profileIds, tx)).map((m) => m.profileId)
    );
    const missing = students.filter((s) => !existingOrg.has(s.profileId));
    await assertStudentCapacityOrThrow(cohort.organizationId, missing.length, tx);

    await insertOrganizationMembersOnConflictDoNothing(
      missing.map((s) => ({
        organizationId: cohort.organizationId,
        roleId: ROLE.STUDENT,
        profileId: s.profileId,
        email: s.candidate.normalizedEmail ?? undefined,
        verified: true
      })),
      tx
    );
    await insertGroupMembersOnConflictDoNothing(
      students.flatMap((s) =>
        courseGroupIds.map((groupId) => ({
          groupId,
          roleId: ROLE.STUDENT,
          profileId: s.profileId,
          email: s.candidate.normalizedEmail ?? undefined
        }))
      ),
      tx
    );
  });

  return outcomes;
}

export async function addCohortMembers(cohortId: string, data: TAddCohortMembers) {
  try {
    const cohort = await getCohortById(cohortId);
    if (!cohort) {
      throw new AppError('Cohort not found', ErrorCodes.COHORT_NOT_FOUND, 404);
    }

    const cohortCourses = await getCoursesByCohort(cohortId);
    const courseGroupIds = (await getCourseGroupIds(cohortCourses.map((course) => course.course.id)))
      .map((courseGroup) => courseGroup.groupId)
      .filter((groupId): groupId is string => Boolean(groupId));

    // Phase G: ONE email lookup and ONE membership lookup for the whole request (was two queries per member,
    // all members in parallel, each holding a pooled connection). The lookup is the same exact-match one
    // getProfileByEmail did, applied to the raw email as given.
    const members: CohortAddMemberInput[] = data.members;
    const emailsToResolve = [...new Set(members.filter((m) => !m.profileId && m.email).map((m) => m.email as string))];
    const profileByEmail = new Map<string, { id: string; email: string | null }>();
    for (let i = 0; i < emailsToResolve.length; i += COHORT_ADD_CHUNK) {
      for (const p of await getProfilesByEmails(emailsToResolve.slice(i, i + COHORT_ADD_CHUNK))) {
        if (p.email && !profileByEmail.has(p.email)) profileByEmail.set(p.email, p);
      }
    }

    const resolved = members.map((m, index) => {
      const profile = !m.profileId && m.email ? (profileByEmail.get(m.email) ?? null) : null;
      return {
        index,
        profileId: m.profileId ?? profile?.id ?? null,
        normalizedEmail: m.email?.toLowerCase().trim() ?? profile?.email ?? null,
        roleId: m.roleId
      } satisfies CohortAddCandidate;
    });

    const existing = await getExistingCohortMembers(
      resolved.filter((c) => c.profileId).map((c) => ({ cohortId, profileId: c.profileId! }))
    );

    const outcomes = new Map<number, unknown>();
    const emailByIndex = new Map(members.map((m, index) => [index, m.email] as const));
    const alreadyMember = (index: number) =>
      new AppError(
        `${emailByIndex.get(index)} is already a member of this cohort`,
        ErrorCodes.MEMBER_ALREADY_IN_COHORT,
        409
      );

    const candidates: CohortAddCandidate[] = [];
    const seenProfiles = new Set<string>();
    for (const c of resolved) {
      if (c.profileId && (existing.has(`${cohortId}:${c.profileId}`) || seenProfiles.has(c.profileId))) {
        outcomes.set(c.index, alreadyMember(c.index));
        continue;
      }
      if (!c.profileId && !members[c.index].email) {
        outcomes.set(
          c.index,
          new AppError('Either profileId or email must be provided for each member', ErrorCodes.VALIDATION_ERROR, 400)
        );
        continue;
      }
      if (c.profileId) seenProfiles.add(c.profileId);
      candidates.push(c);
    }

    for (let i = 0; i < candidates.length; i += COHORT_ADD_CHUNK) {
      const chunk = candidates.slice(i, i + COHORT_ADD_CHUNK);
      try {
        const chunkOutcomes = await addCandidateChunk(cohort, courseGroupIds, chunk, emailByIndex);
        for (const [index, outcome] of chunkOutcomes) outcomes.set(index, outcome);
      } catch (chunkError) {
        console.error('addCohortMembers chunk failed, replaying one member at a time:', chunkError);
        // Sequential on purpose: each replay opens its own short transaction, so only one connection is held.
        for (const candidate of chunk) {
          try {
            outcomes.set(candidate.index, await addCandidateOneByOne(cohort, courseGroupIds, candidate));
          } catch (memberError) {
            outcomes.set(candidate.index, memberError instanceof Error ? memberError : new Error(String(memberError)));
          }
        }
      }
    }

    // Same result shape as before: successful rows and error messages, each in request order.
    const added: unknown[] = [];
    const errors: string[] = [];
    for (let index = 0; index < members.length; index++) {
      const outcome = outcomes.get(index);
      if (outcome instanceof Error) errors.push(outcome.message || 'Unknown error');
      else if (outcome !== undefined) added.push(outcome);
    }

    return { added, errors };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      error instanceof Error ? error.message : 'Failed to add cohort members',
      ErrorCodes.INTERNAL_ERROR,
      500
    );
  }
}

export async function removeCohortMemberService(_cohortId: string, memberId: string) {
  try {
    const deleted = await removeCohortMember(memberId);
    if (!deleted) {
      throw new AppError('Cohort member not found', ErrorCodes.COHORT_MEMBER_NOT_FOUND, 404);
    }
    return deleted;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      error instanceof Error ? error.message : 'Failed to remove cohort member',
      ErrorCodes.INTERNAL_ERROR,
      500
    );
  }
}

export async function updateCohortMemberService(_cohortId: string, memberId: string, data: TUpdateCohortMember) {
  try {
    const updated = await updateCohortMemberQuery(memberId, { roleId: data.roleId });
    if (!updated) {
      throw new AppError('Cohort member not found', ErrorCodes.COHORT_MEMBER_NOT_FOUND, 404);
    }
    return updated;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      error instanceof Error ? error.message : 'Failed to update cohort member',
      ErrorCodes.INTERNAL_ERROR,
      500
    );
  }
}

export async function getEnrolledCohorts(profileId: string) {
  try {
    return getEnrolledCohortsByProfile(profileId);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      error instanceof Error ? error.message : 'Failed to get enrolled cohorts',
      ErrorCodes.INTERNAL_ERROR,
      500
    );
  }
}

// ─── Cohort Courses ──────────────────────────────────────────────────────────

export async function listCohortCourses(cohortId: string, profileId: string) {
  try {
    const roleId = await getCohortMemberRole(cohortId, profileId);
    const onlyPublished = roleId === ROLE.STUDENT;

    return getCoursesByCohort(cohortId, onlyPublished);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      error instanceof Error ? error.message : 'Failed to list cohort courses',
      ErrorCodes.INTERNAL_ERROR,
      500
    );
  }
}

export async function addCourseToCohortService(cohortId: string, data: TAddCourseToCohort) {
  try {
    const cohort = await getCohortById(cohortId);
    if (!cohort) {
      throw new AppError('Cohort not found', ErrorCodes.COHORT_NOT_FOUND, 404);
    }

    const alreadyAdded = await isCohortCourse(cohortId, data.courseId);
    if (alreadyAdded) {
      throw new AppError('Course is already in this cohort', ErrorCodes.COURSE_ALREADY_IN_COHORT, 409);
    }

    const result = await addCourseToCohort(cohortId, data.courseId);
    const students = (await getCohortMembers(cohortId))
      .filter((member) => member.roleId === ROLE.STUDENT && member.profileId)
      .map((member) => ({
        profileId: member.profileId!,
        email: member.email ?? null,
        roleId: member.roleId
      }));

    const courseGroupIds = (await getCourseGroupIds([data.courseId]))
      .map((courseGroup) => courseGroup.groupId)
      .filter((groupId): groupId is string => Boolean(groupId));

    if (students.length > 0 && courseGroupIds.length > 0) {
      await enrollCohortStudentsInGroups(cohort.organizationId, courseGroupIds, students);
    }

    return result;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      error instanceof Error ? error.message : 'Failed to add course to cohort',
      ErrorCodes.INTERNAL_ERROR,
      500
    );
  }
}

export async function removeCourseFromCohortService(cohortId: string, courseId: string) {
  try {
    const deleted = await removeCourseFromCohort(cohortId, courseId);
    if (!deleted) {
      throw new AppError('Course not found in cohort', ErrorCodes.NOT_FOUND, 404);
    }
    return deleted;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      error instanceof Error ? error.message : 'Failed to remove course from cohort',
      ErrorCodes.INTERNAL_ERROR,
      500
    );
  }
}

// ─── Cohort Newsfeed ─────────────────────────────────────────────────────────

export async function listCohortNewsfeed(cohortId: string, options: { cursor?: string; limit: number }) {
  try {
    return getCohortNewsfeed(cohortId, options);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      error instanceof Error ? error.message : 'Failed to list cohort newsfeed',
      ErrorCodes.INTERNAL_ERROR,
      500
    );
  }
}

export async function createCohortNewsfeedService(cohortId: string, profileId: string, data: TCreateCohortNewsfeed) {
  try {
    const member = await getCohortMemberByProfileId(cohortId, profileId);
    if (!member) {
      throw new AppError('User is not a member of this cohort', ErrorCodes.COHORT_FORBIDDEN, 403);
    }

    return createCohortNewsfeedQuery({
      cohortId,
      authorId: member.id,
      content: data.content,
      isPinned: data.isPinned ?? false
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      error instanceof Error ? error.message : 'Failed to create cohort newsfeed',
      ErrorCodes.INTERNAL_ERROR,
      500
    );
  }
}

export async function updateCohortNewsfeedService(feedId: string, data: TUpdateCohortNewsfeed) {
  try {
    const feed = await getCohortNewsfeedById(feedId);
    if (!feed) {
      throw new AppError('Cohort newsfeed item not found', ErrorCodes.COHORT_NEWSFEED_NOT_FOUND, 404);
    }
    return updateCohortNewsfeedQuery(feedId, data);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      error instanceof Error ? error.message : 'Failed to update cohort newsfeed',
      ErrorCodes.INTERNAL_ERROR,
      500
    );
  }
}

export async function updateCohortNewsfeedReactionService(feedId: string, data: TUpdateCohortReaction) {
  try {
    const feed = await getCohortNewsfeedById(feedId);
    if (!feed) {
      throw new AppError('Cohort newsfeed item not found', ErrorCodes.COHORT_NEWSFEED_NOT_FOUND, 404);
    }
    return updateCohortNewsfeedReaction(feedId, data.reaction);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      error instanceof Error ? error.message : 'Failed to update cohort newsfeed reaction',
      ErrorCodes.INTERNAL_ERROR,
      500
    );
  }
}

export async function deleteCohortNewsfeedService(feedId: string) {
  try {
    const feed = await getCohortNewsfeedById(feedId);
    if (!feed) {
      throw new AppError('Cohort newsfeed item not found', ErrorCodes.COHORT_NEWSFEED_NOT_FOUND, 404);
    }
    return deleteCohortNewsfeedQuery(feedId);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      error instanceof Error ? error.message : 'Failed to delete cohort newsfeed',
      ErrorCodes.INTERNAL_ERROR,
      500
    );
  }
}

// ─── Cohort Newsfeed Comments ────────────────────────────────────────────────

export async function listCohortNewsfeedComments(feedId: string) {
  try {
    const feed = await getCohortNewsfeedById(feedId);
    if (!feed) {
      throw new AppError('Cohort newsfeed item not found', ErrorCodes.COHORT_NEWSFEED_NOT_FOUND, 404);
    }
    return getCohortNewsfeedComments(feedId);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      error instanceof Error ? error.message : 'Failed to list cohort newsfeed comments',
      ErrorCodes.INTERNAL_ERROR,
      500
    );
  }
}

export async function createCohortNewsfeedCommentService(
  feedId: string,
  profileId: string,
  data: TCreateCohortNewsfeedComment
) {
  try {
    const feed = await getCohortNewsfeedById(feedId);
    if (!feed) {
      throw new AppError('Cohort newsfeed item not found', ErrorCodes.COHORT_NEWSFEED_NOT_FOUND, 404);
    }
    const member = await getCohortMemberByProfileId(feed.cohortId!, profileId);
    if (!member) {
      throw new AppError('User is not a member of this cohort', ErrorCodes.COHORT_FORBIDDEN, 403);
    }
    return createCohortNewsfeedCommentQuery({
      cohortNewsfeedId: feedId,
      authorId: member.id,
      content: data.content
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      error instanceof Error ? error.message : 'Failed to create cohort newsfeed comment',
      ErrorCodes.INTERNAL_ERROR,
      500
    );
  }
}

export async function deleteCohortNewsfeedCommentService(commentId: number) {
  try {
    const comment = await getCohortNewsfeedCommentById(commentId);
    if (!comment) {
      throw new AppError('Comment not found', ErrorCodes.COHORT_NEWSFEED_COMMENT_NOT_FOUND, 404);
    }
    const feed = await getCohortNewsfeedById(comment.cohortNewsfeedId!);
    if (!feed) {
      throw new AppError('Cohort newsfeed item not found', ErrorCodes.COHORT_NEWSFEED_NOT_FOUND, 404);
    }
    return deleteCohortNewsfeedCommentQuery(commentId);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      error instanceof Error ? error.message : 'Failed to delete cohort newsfeed comment',
      ErrorCodes.INTERNAL_ERROR,
      500
    );
  }
}

// ─── Auth Helpers ────────────────────────────────────────────────────────────

async function assertCohortMember(cohortId: string, profileId: string) {
  const member = await isCohortMember(cohortId, profileId);
  if (!member) {
    throw new AppError('You are not a member of this cohort', ErrorCodes.COHORT_FORBIDDEN, 403);
  }
}
