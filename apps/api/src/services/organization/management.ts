import { AppError, ErrorCodes } from '@api/utils/errors';
import type { Actor } from '@cio/db/actor';
import { isRole } from '@cio/utils/auth';
import { ROLE } from '@cio/utils/constants';
import { listOrgLearnerMembers, listOrgTutorMembersFull, type OrgMemberRow } from '@cio/db/queries/organization';
import { listAllocationsByOrg } from '@cio/db/queries/allocation';
import { getCoursesForLearners, getEnrolmentsForLearners } from '@cio/db/queries/caseload';
import { getUnitTimeForLearners } from '@cio/db/queries/caseload';
import { getLastSeenForUserIds } from '@cio/db/queries/analytics';
import { getCourseEnrolmentTarget } from '@cio/db/queries/onboarding';
import { addCourseMember } from '@cio/db/queries/course';
import { ensureComplianceEnrollmentRecordsForProfiles } from '@api/services/course/compliance';
import { createOrgUser } from '@api/services/organization/users';
import { createTutorAllocation } from '@api/services/organization/allocation';

// Admin Learner-/Tutor-management — org-wide (organizationmember roleId, NOT allocation-scoped). Admin only.

const THIRTY_DAYS_MS = 30 * 86_400_000;

function assertAdmin(actor: Actor): asserts actor is Extract<Actor, { authenticated: true }> {
  if (!actor.authenticated) throw new AppError('Unauthorized', ErrorCodes.UNAUTHORIZED, 401);
  if (!isRole(actor, 'ADMIN')) throw new AppError('Admins only', ErrorCodes.FORBIDDEN, 403);
}

type Activity = 'active' | 'inactive' | 'created' | 'suspended';

function activityOf(status: string, lastSeen: string | null | undefined, now: number): Activity {
  if (status === 'DEACTIVATED') return 'suspended';
  if (!lastSeen) return 'created';
  return now - new Date(lastSeen).getTime() > THIRTY_DAYS_MS ? 'inactive' : 'active';
}

export interface CourseRef {
  courseId: string;
  title: string;
}
export interface LearnerMgmtRow {
  memberId: number;
  userId: string;
  name: string | null;
  email: string | null;
  status: string;
  activity: Activity;
  tutorName: string | null;
  courses: CourseRef[];
  courseCount: number;
  timeSpentSeconds: number;
  lastLogin: string | null;
}
export interface LearnerManagement {
  kpis: { total: number; active: number; inactive: number; created: number; suspended: number };
  rows: LearnerMgmtRow[];
}

/** The Learner Management table: every org learner enriched with tutor, courses, time-spent, last-login. */
export async function getLearnerManagement(actor: Actor): Promise<LearnerManagement> {
  assertAdmin(actor);
  const orgId = actor.orgId;

  const members = await listOrgLearnerMembers(orgId);
  const learnerIds = members.map((m) => m.userId);

  const [allocations, enrolments, times, lastSeen] = await Promise.all([
    listAllocationsByOrg(orgId),
    getEnrolmentsForLearners(learnerIds),
    getUnitTimeForLearners(learnerIds),
    getLastSeenForUserIds(learnerIds)
  ]);

  // learner → first allocated tutor name.
  const tutorByLearner = new Map<string, string>();
  for (const a of allocations) {
    if (a.learnerName === undefined) continue;
    if (!tutorByLearner.has(a.learnerId) && a.tutorName) tutorByLearner.set(a.learnerId, a.tutorName);
  }
  // learner → courses.
  const coursesByLearner = new Map<string, CourseRef[]>();
  for (const e of enrolments) {
    const list = coursesByLearner.get(e.learnerId) ?? [];
    list.push({ courseId: e.courseId, title: e.title });
    coursesByLearner.set(e.learnerId, list);
  }
  // learner → total seconds.
  const secondsByLearner = new Map<string, number>();
  for (const t of times) secondsByLearner.set(t.learnerId, (secondsByLearner.get(t.learnerId) ?? 0) + t.seconds);

  const now = Date.now();
  const kpis = { total: members.length, active: 0, inactive: 0, created: 0, suspended: 0 };

  const rows: LearnerMgmtRow[] = members.map((m) => {
    const last = lastSeen.get(m.userId) ?? null;
    const activity = activityOf(m.status, last, now);
    kpis[activity]++;
    const courses = coursesByLearner.get(m.userId) ?? [];
    return {
      memberId: m.memberId,
      userId: m.userId,
      name: m.name,
      email: m.email,
      status: m.status,
      activity,
      tutorName: tutorByLearner.get(m.userId) ?? null,
      courses,
      courseCount: courses.length,
      timeSpentSeconds: secondsByLearner.get(m.userId) ?? 0,
      lastLogin: last
    };
  });

  return { kpis, rows };
}

export interface TutorMgmtRow {
  memberId: number;
  userId: string;
  name: string | null;
  email: string | null;
  status: string;
  learnerCount: number;
  courses: CourseRef[];
}
export interface TutorManagement {
  count: number;
  rows: TutorMgmtRow[];
}

/** The Tutor Management table: every org tutor with their allocated-learner count + caseload courses. */
export async function getTutorManagement(actor: Actor): Promise<TutorManagement> {
  assertAdmin(actor);
  const orgId = actor.orgId;

  const [members, allocations] = await Promise.all([listOrgTutorMembersFull(orgId), listAllocationsByOrg(orgId)]);

  // tutor → allocated learner ids.
  const learnersByTutor = new Map<string, Set<string>>();
  for (const a of allocations) {
    const set = learnersByTutor.get(a.tutorId) ?? new Set<string>();
    set.add(a.learnerId);
    learnersByTutor.set(a.tutorId, set);
  }

  // All allocated learners' enrolments once → per-learner courses, then aggregate distinct per tutor.
  const allLearnerIds = [...new Set(allocations.map((a) => a.learnerId))];
  const enrolments = await getEnrolmentsForLearners(allLearnerIds);
  const coursesByLearner = new Map<string, CourseRef[]>();
  for (const e of enrolments) {
    const list = coursesByLearner.get(e.learnerId) ?? [];
    list.push({ courseId: e.courseId, title: e.title });
    coursesByLearner.set(e.learnerId, list);
  }

  const rows: TutorMgmtRow[] = members.map((m) => {
    const learners = learnersByTutor.get(m.userId) ?? new Set<string>();
    const courseMap = new Map<string, string>();
    for (const learnerId of learners) {
      for (const c of coursesByLearner.get(learnerId) ?? []) courseMap.set(c.courseId, c.title);
    }
    return {
      memberId: m.memberId,
      userId: m.userId,
      name: m.name,
      email: m.email,
      status: m.status,
      learnerCount: learners.size,
      courses: [...courseMap.entries()].map(([courseId, title]) => ({ courseId, title }))
    };
  });

  return { count: members.length, rows };
}

export interface CreateLearnerInput {
  firstName: string;
  lastName: string;
  email: string;
  courseId?: string | null;
  tutorId?: string | null;
}
export interface CreateResult {
  userId: string;
  name: string;
  temporaryPassword: string;
}

/** Create a learner (auto-gen password revealed), optionally enrol into a course + allocate a tutor. Admin. */
export async function createLearner(actor: Actor, input: CreateLearnerInput): Promise<CreateResult> {
  assertAdmin(actor);
  const orgId = actor.orgId;
  const name = `${input.firstName.trim()} ${input.lastName.trim()}`.trim();
  if (!name) throw new AppError('A name is required', ErrorCodes.VALIDATION_ERROR, 400, 'firstName');
  const email = input.email.trim().toLowerCase();

  // Validate the optional course BEFORE creating the account, so a bad course id doesn't leave an orphan.
  if (input.courseId) {
    const target = await getCourseEnrolmentTarget(input.courseId);
    if (!target || target.orgId !== orgId)
      throw new AppError('Course not found', ErrorCodes.NOT_FOUND, 404, 'courseId');
    if (!target.isPublished) {
      throw new AppError('You can only enrol into a published course', ErrorCodes.VALIDATION_ERROR, 400, 'courseId');
    }
  }

  const { userId, temporaryPassword } = await createOrgUser(orgId, actor, { name, email, roleId: ROLE.STUDENT });

  if (input.courseId) {
    await addCourseMember(input.courseId, { profileId: userId, roleId: ROLE.STUDENT, email });
    await ensureComplianceEnrollmentRecordsForProfiles([input.courseId], [userId]);
  }
  if (input.tutorId) {
    await createTutorAllocation(orgId, actor, { tutorId: input.tutorId, learnerId: userId });
  }

  return { userId, name, temporaryPassword };
}

export interface CreateTutorInput {
  firstName: string;
  lastName: string;
  email: string;
}

/** Create a tutor (auto-gen password revealed). Admin. */
export async function createTutor(actor: Actor, input: CreateTutorInput): Promise<CreateResult> {
  assertAdmin(actor);
  const name = `${input.firstName.trim()} ${input.lastName.trim()}`.trim();
  if (!name) throw new AppError('A name is required', ErrorCodes.VALIDATION_ERROR, 400, 'firstName');
  const email = input.email.trim().toLowerCase();
  const { userId, temporaryPassword } = await createOrgUser(actor.orgId, actor, {
    name,
    email,
    roleId: ROLE.TUTOR
  });
  return { userId, name, temporaryPassword };
}

export type { OrgMemberRow };
