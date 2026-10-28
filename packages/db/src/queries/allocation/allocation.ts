import * as schema from '@db/schema';

import { and, asc, count, db, eq, ilike, notExists, or, sql } from '@db/drizzle';
import { alias } from 'drizzle-orm/pg-core';

// Tutor↔learner allocation (PearlLMS Phase 3). Provider-wide pairs; a tutor is "staff" only for the
// learners allocated to them. `isTutorAllocatedToLearner` backs the real isAllocatedTutor guard.
//
// Per-learner model: the tutor roster (`listLearnersForTutor`) and the isAllocatedTutor guard are ALLOCATION
// ONLY — a tutor sees/reaches just their individually-allocated learners. Course-team membership (a
// course-team TUTOR, groupmember roleId 2, of a course) grants COURSE-level access only (`isCourseTutor`);
// it no longer adds learners to the roster or grants learner-level access.

const ROLE_STUDENT_ID = 3;
const ROLE_TUTOR_ID = 2;

/**
 * Is this tutor a course-team TUTOR of a course this learner is enrolled in (as STUDENT)? The course-team
 * side of tutor responsibility (the allocation side is `isTutorAllocatedToLearner`). Derived live from
 * groupmember rows — no allocation row needed. (No PII — ids only.)
 */
export async function isCourseTutorForLearner(tutorId: string, learnerId: string): Promise<boolean> {
  const tut = alias(schema.groupmember, 'tut_member');
  const stu = alias(schema.groupmember, 'stu_member');
  const rows = await db
    .select({ id: tut.id })
    .from(tut)
    .innerJoin(stu, and(eq(stu.groupId, tut.groupId), eq(stu.roleId, ROLE_STUDENT_ID)))
    .where(and(eq(tut.profileId, tutorId), eq(tut.roleId, ROLE_TUTOR_ID), eq(stu.profileId, learnerId)))
    .limit(1);
  return rows.length > 0;
}

/** Is this tutor a course-team TUTOR (roleId 2) of this course? (The course→tutor assignment link.) */
export async function isCourseTutor(tutorId: string, courseId: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.groupmember.id })
    .from(schema.groupmember)
    .innerJoin(schema.course, eq(schema.course.groupId, schema.groupmember.groupId))
    .where(
      and(
        eq(schema.course.id, courseId),
        eq(schema.groupmember.profileId, tutorId),
        eq(schema.groupmember.roleId, ROLE_TUTOR_ID)
      )
    )
    .limit(1);
  return rows.length > 0;
}

/** Does an allocation row pair this tutor with this learner? (No PII — ids only.) */
export async function isTutorAllocatedToLearner(tutorId: string, learnerId: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.tutorAllocation.id })
    .from(schema.tutorAllocation)
    .where(and(eq(schema.tutorAllocation.tutorId, tutorId), eq(schema.tutorAllocation.learnerId, learnerId)))
    .limit(1);
  return rows.length > 0;
}

/**
 * Does this tutor have at least one allocated learner ENROLLED (roleId 3 = STUDENT) in this course? Backs
 * the tutor's read-only course-content access — a tutor may open a course only if they actually mark
 * learners on it. (No PII — ids only.)
 */
export async function isTutorAllocatedToCourse(tutorId: string, courseId: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.tutorAllocation.id })
    .from(schema.tutorAllocation)
    .innerJoin(
      schema.groupmember,
      and(eq(schema.groupmember.profileId, schema.tutorAllocation.learnerId), eq(schema.groupmember.roleId, 3))
    )
    .innerJoin(schema.group, eq(schema.group.id, schema.groupmember.groupId))
    .innerJoin(schema.course, eq(schema.course.groupId, schema.group.id))
    .where(and(eq(schema.tutorAllocation.tutorId, tutorId), eq(schema.course.id, courseId)))
    .limit(1);
  return rows.length > 0;
}

/**
 * The learner ids allocated to this tutor AND enrolled (STUDENT) in this course — the tutor's roster for
 * that course's submissions grid ("Separate groups: <tutor>"). Distinct.
 */
export async function listAllocatedLearnerIdsForCourse(tutorId: string, courseId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ learnerId: schema.tutorAllocation.learnerId })
    .from(schema.tutorAllocation)
    .innerJoin(
      schema.groupmember,
      and(eq(schema.groupmember.profileId, schema.tutorAllocation.learnerId), eq(schema.groupmember.roleId, 3))
    )
    .innerJoin(schema.group, eq(schema.group.id, schema.groupmember.groupId))
    .innerJoin(schema.course, eq(schema.course.groupId, schema.group.id))
    .where(and(eq(schema.tutorAllocation.tutorId, tutorId), eq(schema.course.id, courseId)));
  return rows.map((r) => r.learnerId);
}

export interface CreateAllocationInput {
  organizationId: string;
  tutorId: string;
  learnerId: string;
  createdBy: string;
}

export async function createAllocation(input: CreateAllocationInput) {
  const [row] = await db.insert(schema.tutorAllocation).values(input).returning();
  return row;
}

export async function getAllocationById(id: string) {
  const [row] = await db.select().from(schema.tutorAllocation).where(eq(schema.tutorAllocation.id, id)).limit(1);
  return row ?? null;
}

export async function deleteAllocationById(id: string) {
  const [row] = await db.delete(schema.tutorAllocation).where(eq(schema.tutorAllocation.id, id)).returning();
  return row ?? null;
}

export interface AllocationWithNames {
  id: string;
  tutorId: string;
  learnerId: string;
  createdAt: string | null;
  tutorName: string | null;
  tutorEmail: string | null;
  learnerName: string | null;
  learnerEmail: string | null;
}

/** All allocations in an org, with tutor + learner display names (for the Manager/Admin UI). */
export async function listAllocationsByOrg(organizationId: string): Promise<AllocationWithNames[]> {
  const tutor = alias(schema.profile, 'tutor_profile');
  const learner = alias(schema.profile, 'learner_profile');
  return db
    .select({
      id: schema.tutorAllocation.id,
      tutorId: schema.tutorAllocation.tutorId,
      learnerId: schema.tutorAllocation.learnerId,
      createdAt: schema.tutorAllocation.createdAt,
      tutorName: tutor.fullname,
      tutorEmail: tutor.email,
      learnerName: learner.fullname,
      learnerEmail: learner.email
    })
    .from(schema.tutorAllocation)
    .leftJoin(tutor, eq(tutor.id, schema.tutorAllocation.tutorId))
    .leftJoin(learner, eq(learner.id, schema.tutorAllocation.learnerId))
    .where(eq(schema.tutorAllocation.organizationId, organizationId))
    .orderBy(schema.tutorAllocation.createdAt);
}

export interface ListAllocationsPageOptions {
  page?: number;
  limit?: number;
  tutorId?: string;
  learnerId?: string;
  /** Case-insensitive match on either side's name/email. */
  search?: string;
}

/**
 * One page of the org's allocations (the Manager/Admin table), filterable by tutor / learner / free-text
 * search. Stable order (`created_at, id`) so pages never skip or repeat a row. `listAllocationsByOrg` stays
 * the unpaginated read for the management aggregates (tutor learner-counts need every pair).
 */
export async function listAllocationsPageByOrg(organizationId: string, options: ListAllocationsPageOptions = {}) {
  const page = options.page && options.page > 0 ? options.page : 1;
  const limit = options.limit && options.limit > 0 ? Math.min(options.limit, 100) : 50;
  const offset = (page - 1) * limit;
  const search = options.search?.trim();

  const tutor = alias(schema.profile, 'tutor_profile');
  const learner = alias(schema.profile, 'learner_profile');

  const conditions = [eq(schema.tutorAllocation.organizationId, organizationId)];
  if (options.tutorId) conditions.push(eq(schema.tutorAllocation.tutorId, options.tutorId));
  if (options.learnerId) conditions.push(eq(schema.tutorAllocation.learnerId, options.learnerId));
  if (search) {
    const value = `%${search}%`;
    conditions.push(
      or(
        ilike(tutor.fullname, value),
        ilike(tutor.email, value),
        ilike(learner.fullname, value),
        ilike(learner.email, value)
      )!
    );
  }
  const where = and(...conditions);

  const [totalRow] = await db
    .select({ count: count() })
    .from(schema.tutorAllocation)
    .leftJoin(tutor, eq(tutor.id, schema.tutorAllocation.tutorId))
    .leftJoin(learner, eq(learner.id, schema.tutorAllocation.learnerId))
    .where(where);
  const total = Number(totalRow?.count ?? 0);

  const items: AllocationWithNames[] = await db
    .select({
      id: schema.tutorAllocation.id,
      tutorId: schema.tutorAllocation.tutorId,
      learnerId: schema.tutorAllocation.learnerId,
      createdAt: schema.tutorAllocation.createdAt,
      tutorName: tutor.fullname,
      tutorEmail: tutor.email,
      learnerName: learner.fullname,
      learnerEmail: learner.email
    })
    .from(schema.tutorAllocation)
    .leftJoin(tutor, eq(tutor.id, schema.tutorAllocation.tutorId))
    .leftJoin(learner, eq(learner.id, schema.tutorAllocation.learnerId))
    .where(where)
    .orderBy(asc(schema.tutorAllocation.createdAt), asc(schema.tutorAllocation.id))
    .limit(limit)
    .offset(offset);

  return { items, page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

export interface AssignablePersonRow {
  userId: string;
  name: string;
  email: string;
}

export interface SearchAssignablePeopleOptions {
  /** 2 (TUTOR) or 3 (STUDENT) — the org-scoped role of the people being searched. */
  role: number;
  search?: string;
  limit?: number;
  /**
   * When searching learners: hide learners already allocated to this tutor. When searching tutors: hide
   * tutors already allocated to this learner. (The DB UNIQUE would 409 on them anyway.)
   */
  excludePairedWith?: string;
}

/**
 * ACTIVE org members of one role, matched by name/email, for the allocation typeahead pickers. Capped
 * (default 20, max 50) — never a roster dump. Deactivated users and members with no profile row are
 * excluded. Authorization is unchanged: `createTutorAllocation` still re-validates both roles server-side.
 */
export async function searchAssignablePeople(
  organizationId: string,
  options: SearchAssignablePeopleOptions
): Promise<AssignablePersonRow[]> {
  const limit = options.limit && options.limit > 0 ? Math.min(options.limit, 50) : 20;
  const search = options.search?.trim();

  const conditions = [
    eq(schema.organizationmember.organizationId, organizationId),
    eq(schema.organizationmember.roleId, options.role),
    eq(schema.profile.status, 'ACTIVE')
  ];
  if (search) {
    const value = `%${search}%`;
    conditions.push(or(ilike(schema.profile.fullname, value), ilike(schema.profile.email, value))!);
  }
  if (options.excludePairedWith) {
    const searchingLearners = options.role === ROLE_STUDENT_ID;
    const pairedCol = searchingLearners ? schema.tutorAllocation.tutorId : schema.tutorAllocation.learnerId;
    const selfCol = searchingLearners ? schema.tutorAllocation.learnerId : schema.tutorAllocation.tutorId;
    conditions.push(
      notExists(
        db
          .select({ one: sql`1` })
          .from(schema.tutorAllocation)
          .where(and(eq(pairedCol, options.excludePairedWith), eq(selfCol, schema.profile.id)))
      )
    );
  }

  const rows = await db
    .select({
      userId: schema.profile.id,
      fullname: schema.profile.fullname,
      profileEmail: schema.profile.email,
      memberEmail: schema.organizationmember.email
    })
    .from(schema.organizationmember)
    .innerJoin(schema.profile, eq(schema.organizationmember.profileId, schema.profile.id))
    .where(and(...conditions))
    .orderBy(asc(schema.profile.fullname), asc(schema.profile.id))
    .limit(limit);

  return rows.map((row) => {
    const email = (row.profileEmail || row.memberEmail || '').trim();
    const name = row.fullname?.trim() || (email.includes('@') ? email.split('@')[0] : email) || '';
    return { userId: row.userId, name, email };
  });
}

export interface AllocatedLearner {
  learnerId: string;
  name: string | null;
  email: string | null;
}

/** Distinct-merge two learner rosters by learnerId, keeping the first name/email seen, ordered by name. */
function mergeLearners(...lists: AllocatedLearner[][]): AllocatedLearner[] {
  const byId = new Map<string, AllocatedLearner>();
  for (const list of lists) for (const l of list) if (!byId.has(l.learnerId)) byId.set(l.learnerId, l);
  return [...byId.values()].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
}

/**
 * The learners ONE tutor is responsible for — the caseload's roster (PearlLMS Phase 3 Step 4). ALLOCATION
 * ONLY (per-learner model): just the learners individually allocated to them (`tutor_allocation`). Course-team
 * membership does NOT add learners here. Distinct by learner, ordered by name. Mirrors the isAllocatedTutor
 * guard so the caseload never lists a learner the tutor can't reach.
 */
export async function listLearnersForTutor(tutorId: string): Promise<AllocatedLearner[]> {
  const allocated = (await db
    .selectDistinct({
      learnerId: schema.tutorAllocation.learnerId,
      name: schema.profile.fullname,
      email: schema.profile.email
    })
    .from(schema.tutorAllocation)
    .leftJoin(schema.profile, eq(schema.profile.id, schema.tutorAllocation.learnerId))
    .where(eq(schema.tutorAllocation.tutorId, tutorId))) as AllocatedLearner[];
  return mergeLearners(allocated);
}

export interface AllocatedTutor {
  tutorId: string;
  email: string | null;
}

/**
 * The tutors allocated to ONE learner, distinct, with email (PearlLMS Phase 3 Step 6). Backs the
 * "submission created → the learner's allocated tutor(s)" notification. Sourced from `tutor_allocation`;
 * an empty result means the learner has no allocated tutor yet (caller sends nothing).
 */
export async function listTutorsForLearner(learnerId: string): Promise<AllocatedTutor[]> {
  return db
    .selectDistinct({ tutorId: schema.tutorAllocation.tutorId, email: schema.profile.email })
    .from(schema.tutorAllocation)
    .leftJoin(schema.profile, eq(schema.profile.id, schema.tutorAllocation.tutorId))
    .where(eq(schema.tutorAllocation.learnerId, learnerId));
}

/** Distinct STUDENT learners in this org's courses that have at least one course-team TUTOR assigned. */
async function listCourseTeamLearnersForOrg(organizationId: string): Promise<AllocatedLearner[]> {
  const tut = alias(schema.groupmember, 'tut_member');
  const stu = alias(schema.groupmember, 'stu_member');
  return db
    .selectDistinct({ learnerId: stu.profileId, name: schema.profile.fullname, email: schema.profile.email })
    .from(schema.group)
    .innerJoin(tut, and(eq(tut.groupId, schema.group.id), eq(tut.roleId, ROLE_TUTOR_ID)))
    .innerJoin(stu, and(eq(stu.groupId, schema.group.id), eq(stu.roleId, ROLE_STUDENT_ID)))
    .innerJoin(schema.profile, eq(schema.profile.id, stu.profileId))
    .where(eq(schema.group.organizationId, organizationId)) as Promise<AllocatedLearner[]>;
}

/**
 * Every supervised learner in an org, distinct (for the Admin oversight caseload). The UNION of allocated
 * learners AND learners in a course that has a course-team TUTOR — so the Admin oversight caseload matches
 * the union of the tutors' (now course-extended) caseloads.
 */
export async function listAllocatedLearnersForOrg(organizationId: string): Promise<AllocatedLearner[]> {
  const [allocated, courseTeam] = await Promise.all([
    db
      .selectDistinct({
        learnerId: schema.tutorAllocation.learnerId,
        name: schema.profile.fullname,
        email: schema.profile.email
      })
      .from(schema.tutorAllocation)
      .leftJoin(schema.profile, eq(schema.profile.id, schema.tutorAllocation.learnerId))
      .where(eq(schema.tutorAllocation.organizationId, organizationId)) as Promise<AllocatedLearner[]>,
    listCourseTeamLearnersForOrg(organizationId)
  ]);
  return mergeLearners(allocated, courseTeam);
}

/** A profile's role id in an org (for validating tutor=TUTOR, learner=STUDENT before allocating). */
export async function getOrgMemberRoleId(organizationId: string, profileId: string): Promise<number | null> {
  const rows = await db
    .select({ roleId: schema.organizationmember.roleId })
    .from(schema.organizationmember)
    .where(
      and(
        eq(schema.organizationmember.organizationId, organizationId),
        eq(schema.organizationmember.profileId, profileId)
      )
    )
    .limit(1);
  return rows[0]?.roleId ?? null;
}
