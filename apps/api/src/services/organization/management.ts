import { AppError, ErrorCodes } from '@api/utils/errors';
import type { Actor } from '@cio/db/actor';
import { isRole } from '@cio/utils/auth';
import { ROLE } from '@cio/utils/constants';
import {
  getSuperAdminMemberId,
  listOrgAdminMembers,
  listOrgLearnerMembers,
  listOrgTutorMembersFull,
  type OrgMemberRow
} from '@cio/db/queries/organization';
import { listAllocationsByOrg } from '@cio/db/queries/allocation';
import { getCoursesForLearners, getEnrolmentsForLearners } from '@cio/db/queries/caseload';
import { getUnitTimeForLearners } from '@cio/db/queries/caseload';
import { getLastSeenForUserIds } from '@cio/db/queries/analytics';
import { getCourseEnrolmentTarget, listAllCoursesForOrg } from '@cio/db/queries/onboarding';
import {
  addCourseMember,
  listOrgTutorCourseAssignments,
  listTutorCourses,
  setTutorCourseAssignments
} from '@cio/db/queries/course';
import { ensureComplianceEnrollmentRecordsForProfiles } from '@api/services/course/compliance';
import { createOrgUser } from '@api/services/organization/users';
import { createTutorAllocation } from '@api/services/organization/allocation';
import { getOrganizationMemberByIdAndOrg } from '@cio/db/queries/organization';
import { getOrgMemberRoleId } from '@cio/db/queries/allocation';
import { getProfileById } from '@cio/db/queries/auth';
import { mintLoginLinkToken } from '@cio/db/auth';
import { recordAudit, AUDIT_ACTIONS } from '@cio/db/audit';

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

  const [members, allocations, assignments] = await Promise.all([
    listOrgTutorMembersFull(orgId),
    listAllocationsByOrg(orgId),
    listOrgTutorCourseAssignments(orgId)
  ]);

  // tutor → allocated learner ids.
  const learnersByTutor = new Map<string, Set<string>>();
  for (const a of allocations) {
    const set = learnersByTutor.get(a.tutorId) ?? new Set<string>();
    set.add(a.learnerId);
    learnersByTutor.set(a.tutorId, set);
  }

  // tutor → directly-assigned (taught) courses.
  const assignedByTutor = new Map<string, Map<string, string>>();
  for (const a of assignments) {
    if (!a.tutorId) continue;
    const map = assignedByTutor.get(a.tutorId) ?? new Map<string, string>();
    map.set(a.courseId, a.title ?? 'Untitled course');
    assignedByTutor.set(a.tutorId, map);
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
    // Courses = directly-assigned (taught) courses ∪ courses derived from allocated learners' enrolments.
    const courseMap = new Map<string, string>(assignedByTutor.get(m.userId) ?? new Map());
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

export interface AdminMgmtRow {
  memberId: number;
  userId: string;
  name: string | null;
  email: string | null;
  status: string;
  lastLogin: string | null;
  isSuperAdmin: boolean;
  isSelf: boolean;
}
export interface AdminManagement {
  count: number;
  rows: AdminMgmtRow[];
}

/**
 * The Admin Management table: every org admin, flagged with isSuperAdmin (the protected earliest admin whose
 * password can't be reset) and isSelf (the caller — who resets via Change Password, not here). Admin only.
 */
export async function getAdminManagement(actor: Actor): Promise<AdminManagement> {
  assertAdmin(actor);
  const orgId = actor.orgId;

  const [members, superAdminMemberId] = await Promise.all([listOrgAdminMembers(orgId), getSuperAdminMemberId(orgId)]);
  const lastSeen = await getLastSeenForUserIds(members.map((m) => m.userId));

  const rows: AdminMgmtRow[] = members.map((m) => ({
    memberId: m.memberId,
    userId: m.userId,
    name: m.name,
    email: m.email,
    status: m.status,
    lastLogin: lastSeen.get(m.userId) ?? null,
    isSuperAdmin: m.memberId === superAdminMemberId,
    isSelf: actor.userId === m.userId
  }));

  return { count: members.length, rows };
}

export interface CreateLearnerInput {
  firstName: string;
  lastName: string;
  email: string;
  courseId: string;
  tutorId: string;
}
export interface CreateResult {
  userId: string;
  name: string;
  temporaryPassword: string;
}

/** Create a learner (auto-gen password revealed), enrol into a course + allocate a tutor (both required). Admin. */
export async function createLearner(actor: Actor, input: CreateLearnerInput): Promise<CreateResult> {
  assertAdmin(actor);
  const orgId = actor.orgId;
  const name = `${input.firstName.trim()} ${input.lastName.trim()}`.trim();
  if (!name) throw new AppError('A name is required', ErrorCodes.VALIDATION_ERROR, 400, 'firstName');
  const email = input.email.trim().toLowerCase();

  // A learner is always enrolled in a course and assigned a tutor — validate BOTH before creating the
  // account so a bad id doesn't leave an orphan. Course must belong to this org and be published; the
  // tutor↔learner allocation validates the tutor's role in createTutorAllocation.
  const target = await getCourseEnrolmentTarget(input.courseId);
  if (!target || target.orgId !== orgId) throw new AppError('Course not found', ErrorCodes.NOT_FOUND, 404, 'courseId');
  if (!target.isPublished) {
    throw new AppError('You can only enrol into a published course', ErrorCodes.VALIDATION_ERROR, 400, 'courseId');
  }

  const { userId, temporaryPassword } = await createOrgUser(orgId, actor, { name, email, roleId: ROLE.STUDENT });

  await addCourseMember(input.courseId, { profileId: userId, roleId: ROLE.STUDENT, email });
  await ensureComplianceEnrollmentRecordsForProfiles([input.courseId], [userId]);
  await createTutorAllocation(orgId, actor, { tutorId: input.tutorId, learnerId: userId });

  return { userId, name, temporaryPassword };
}

export interface CreateTutorInput {
  firstName: string;
  lastName: string;
  email: string;
  courseIds?: string[] | null;
}

/** Create a tutor (auto-gen password revealed), optionally assigning them to teach courses. Admin. */
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
  if (input.courseIds && input.courseIds.length > 0) {
    await setTutorCourseAssignments(actor.orgId, userId, email, input.courseIds);
  }
  return { userId, name, temporaryPassword };
}

/** Resolve a member id → a TUTOR profile in this org (or 404/400). Guards the course-assignment endpoints. */
async function resolveTutorMember(
  actor: Extract<Actor, { authenticated: true }>,
  memberId: number
): Promise<{ profileId: string; email: string | null }> {
  const orgId = actor.orgId;
  const member = await getOrganizationMemberByIdAndOrg(memberId, orgId);
  if (!member?.profileId) throw new AppError('Tutor not found in this organization', ErrorCodes.NOT_FOUND, 404);
  const roleId = await getOrgMemberRoleId(orgId, member.profileId);
  if (roleId !== ROLE.TUTOR) throw new AppError('This member is not a tutor', ErrorCodes.VALIDATION_ERROR, 400);
  const profile = await getProfileById(member.profileId);
  return { profileId: member.profileId, email: profile?.email ?? null };
}

export interface TutorCoursesResult {
  assignedCourseIds: string[];
  courses: { courseId: string; title: string | null }[];
}

/** Every assignable course in the org (published or draft) — for the create-tutor course picker. Admin. */
export async function listAssignableCourses(actor: Actor): Promise<{ courseId: string; title: string | null }[]> {
  assertAdmin(actor);
  return listAllCoursesForOrg(actor.orgId);
}

/** The tutor's currently-assigned (taught) course ids + every assignable org course. Admin. */
export async function getTutorCourses(actor: Actor, memberId: number): Promise<TutorCoursesResult> {
  assertAdmin(actor);
  const { profileId } = await resolveTutorMember(actor, memberId);
  const [assigned, courses] = await Promise.all([
    listTutorCourses(actor.orgId, profileId),
    listAllCoursesForOrg(actor.orgId)
  ]);
  return { assignedCourseIds: assigned.map((c) => c.courseId), courses };
}

/** Set a tutor's taught courses to exactly `courseIds` (org-scoped reconcile). Returns the new set. Admin. */
export async function setTutorCourses(
  actor: Actor,
  memberId: number,
  courseIds: string[]
): Promise<TutorCoursesResult> {
  assertAdmin(actor);
  const { profileId, email } = await resolveTutorMember(actor, memberId);
  await setTutorCourseAssignments(actor.orgId, profileId, email, courseIds);

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.USER_STATUS_CHANGED,
    entityType: 'user',
    entityId: profileId,
    metadata: { tutor_courses_set: courseIds.length }
  });

  const [assigned, courses] = await Promise.all([
    listTutorCourses(actor.orgId, profileId),
    listAllCoursesForOrg(actor.orgId)
  ]);
  return { assignedCourseIds: assigned.map((c) => c.courseId), courses };
}

export interface ImpersonationStart {
  token: string;
  adminUserId: string;
  adminEmail: string;
  targetName: string | null;
}

/**
 * Admin "Login as" — mint a short-lived login-link token for a target learner/tutor. The route sets a
 * signed cookie remembering the admin so "Return to admin" can restore them. Admin can only impersonate a
 * LEARNER or TUTOR (never another admin/manager). Audited.
 */
export async function startImpersonation(actor: Actor, memberId: number): Promise<ImpersonationStart> {
  assertAdmin(actor);
  const orgId = actor.orgId;
  const member = await getOrganizationMemberByIdAndOrg(memberId, orgId);
  if (!member?.profileId) throw new AppError('User not found in this organization', ErrorCodes.NOT_FOUND, 404);

  const targetRole = await getOrgMemberRoleId(orgId, member.profileId);
  if (targetRole !== ROLE.STUDENT && targetRole !== ROLE.TUTOR) {
    throw new AppError('You can only view as a learner or a tutor', ErrorCodes.FORBIDDEN, 403);
  }

  const [target, admin] = await Promise.all([getProfileById(member.profileId), getProfileById(actor.userId)]);
  if (!target?.email) throw new AppError('This account has no email', ErrorCodes.NOT_FOUND, 404);
  if (!admin?.email) throw new AppError('Your account has no email', ErrorCodes.INTERNAL_ERROR, 500);

  const token = await mintLoginLinkToken({ userId: member.profileId, email: target.email, ttlMinutes: 5 });

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.USER_STATUS_CHANGED,
    entityType: 'user',
    entityId: member.profileId,
    metadata: { impersonation_started: true }
  });

  return { token, adminUserId: actor.userId, adminEmail: admin.email, targetName: target.fullname ?? null };
}

/** Mint a login-link token that returns an impersonating admin to their own account. */
export async function mintReturnToAdminToken(adminUserId: string, adminEmail: string): Promise<string> {
  return mintLoginLinkToken({ userId: adminUserId, email: adminEmail, ttlMinutes: 5 });
}

export type { OrgMemberRow };
