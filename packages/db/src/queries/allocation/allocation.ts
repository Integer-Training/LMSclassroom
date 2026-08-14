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
