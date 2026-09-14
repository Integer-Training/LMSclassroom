import * as schema from '@db/schema';

import { and, db, eq } from '@db/drizzle';
import { alias } from 'drizzle-orm/pg-core';

// Tutor↔learner allocation (PearlLMS Phase 3). Provider-wide pairs; a tutor is "staff" only for the
// learners allocated to them. `isTutorAllocatedToLearner` backs the real isAllocatedTutor guard.

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

export interface AllocatedLearner {
  learnerId: string;
  name: string | null;
  email: string | null;
}

/**
 * The learners allocated to ONE tutor — the caseload's roster (PearlLMS Phase 3 Step 4). Sourced
 * straight from `tutor_allocation` (the same table isAllocatedTutor reads), so the caseload can never
 * list a learner the tutor is not allocated to. Distinct by learner, ordered by name.
 */
export async function listLearnersForTutor(tutorId: string): Promise<AllocatedLearner[]> {
  return db
    .selectDistinct({
      learnerId: schema.tutorAllocation.learnerId,
      name: schema.profile.fullname,
      email: schema.profile.email
    })
    .from(schema.tutorAllocation)
    .leftJoin(schema.profile, eq(schema.profile.id, schema.tutorAllocation.learnerId))
    .where(eq(schema.tutorAllocation.tutorId, tutorId))
    .orderBy(schema.profile.fullname);
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

/**
 * Every allocated learner in an org, distinct (for the Admin oversight caseload). Also allocation-
 * backed — Admin sees the union of the tutors' caseloads, never a learner set assembled some other way.
 */
export async function listAllocatedLearnersForOrg(organizationId: string): Promise<AllocatedLearner[]> {
  return db
    .selectDistinct({
      learnerId: schema.tutorAllocation.learnerId,
      name: schema.profile.fullname,
      email: schema.profile.email
    })
    .from(schema.tutorAllocation)
    .leftJoin(schema.profile, eq(schema.profile.id, schema.tutorAllocation.learnerId))
    .where(eq(schema.tutorAllocation.organizationId, organizationId))
    .orderBy(schema.profile.fullname);
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
