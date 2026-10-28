import type { Actor } from '@cio/db/actor';
import { listLearnersForTutor } from '@cio/db/queries/allocation';
import { ROLE } from '@cio/utils/constants';
import { visibleLearnerIdsForCourse } from '@api/middlewares/guards';

// Learner-visibility rule (owner-approved) applied to a roster (course group members, cohort members, and
// the course `attendance` rows):
//  - ADMIN: everyone.
//  - TUTOR: staff (ADMIN/TUTOR rows) + learners allocated to them. A course-team tutor with no allocation
//    sees no learners — course-team membership grants materials only, never learner data.
//  - STUDENT/anyone else (incl. anonymous on the public slug route): staff + their own row only, so a
//    learner never sees classmates' names or emails.
type RosterMember = { roleId?: number | string | null; profileId?: string | null };

/** Pure rule. `allocatedLearnerIds` is only consulted for a TUTOR actor. */
export function filterRosterForViewer<M extends RosterMember>(
  members: M[],
  actor: Actor | undefined,
  allocatedLearnerIds: ReadonlySet<string>
): M[] {
  const role = actor?.authenticated ? actor.role : null;
  if (role === 'ADMIN') return members;

  const isStaffRow = (m: M) => Number(m.roleId) === ROLE.ADMIN || Number(m.roleId) === ROLE.TUTOR;
  const selfId = actor?.authenticated ? actor.userId : null;

  return members.filter(
    (m) =>
      isStaffRow(m) ||
      (!!selfId && m.profileId === selfId) ||
      (role === 'TUTOR' && !!m.profileId && allocatedLearnerIds.has(m.profileId))
  );
}

export async function filterCourseMembersForViewer<M extends RosterMember>(
  members: M[],
  courseId: string,
  actor: Actor | undefined
): Promise<M[]> {
  const allocated =
    actor?.authenticated && actor.role === 'TUTOR'
      ? new Set(await visibleLearnerIdsForCourse(actor, courseId))
      : new Set<string>();
  return filterRosterForViewer(members, actor, allocated);
}

export async function filterCohortMembersForViewer<M extends RosterMember>(
  members: M[],
  actor: Actor | undefined
): Promise<M[]> {
  const allocated =
    actor?.authenticated && actor.role === 'TUTOR'
      ? new Set((await listLearnersForTutor(actor.userId)).map((l) => l.learnerId))
      : new Set<string>();
  return filterRosterForViewer(members, actor, allocated);
}

/**
 * Returns the course payload with `group.members` AND `attendance` filtered for the viewer. Attendance rows
 * key on the learner's groupmember id (`studentId`), so they are kept iff that member row is visible.
 */
export async function withVisibleCourseMembers<
  C extends {
    id: string;
    group?: { members?: Array<RosterMember & { id?: string }> } | null;
    attendance?: Array<{ studentId?: string | null }>;
  }
>(course: C, actor: Actor | undefined): Promise<C> {
  if (!course.group?.members) return course;

  const members = await filterCourseMembersForViewer(course.group.members, course.id, actor);
  const visibleMemberIds = new Set(members.map((m) => m.id));
  const attendance = actor?.authenticated
    ? course.attendance?.filter((row) => !!row.studentId && visibleMemberIds.has(row.studentId))
    : course.attendance && [];

  return { ...course, group: { ...course.group, members }, ...(attendance ? { attendance } : {}) } as C;
}
