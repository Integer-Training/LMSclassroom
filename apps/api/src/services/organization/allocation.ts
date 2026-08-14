import { AppError, ErrorCodes } from '@api/utils/errors';
import type { Actor } from '@cio/db/actor';
import { recordAudit, AUDIT_ACTIONS } from '@cio/db/audit';
import { ROLE } from '@cio/utils/constants';
import { isUniqueConstraintViolation } from '@cio/utils/errors';
import {
  createAllocation,
  deleteAllocationById,
  getAllocationById,
  getOrgMemberRoleId,
  listAllocationsByOrg,
  type AllocationWithNames
} from '@cio/db/queries/allocation';
import { getOrganizationUsers } from '@cio/db/queries/organization';

// Tutor↔learner allocation management (PearlLMS Phase 3). Manager/Admin only — enforced at the route
// (requireManagerOrAdmin). Every mutation validates roles against the org membership (never trust the
// client's word) and audits with USER IDS ONLY — no names/emails in metadata.

/** All allocations in the org, with tutor + learner display names (the Manager/Admin table). */
export async function listOrgAllocations(orgId: string): Promise<AllocationWithNames[]> {
  return listAllocationsByOrg(orgId);
}

export interface AssignablePerson {
  userId: string;
  name: string;
  email: string;
}
export interface AssignablePeople {
  tutors: AssignablePerson[];
  learners: AssignablePerson[];
}

/** ACTIVE tutors + learners in the org, for the allocation pickers (Manager/Admin surface). */
export async function getAssignablePeople(orgId: string): Promise<AssignablePeople> {
  const [tutors, learners] = await Promise.all([
    getOrganizationUsers(orgId, { role: ROLE.TUTOR, status: 'ACTIVE', limit: 100 }),
    getOrganizationUsers(orgId, { role: ROLE.STUDENT, status: 'ACTIVE', limit: 100 })
  ]);
  const toPerson = (r: { userId: string | null; name: string; email: string }): AssignablePerson => ({
    userId: r.userId as string,
    name: r.name,
    email: r.email
  });
  return {
    tutors: tutors.items.filter((r) => r.userId).map(toPerson),
    learners: learners.items.filter((r) => r.userId).map(toPerson)
  };
}

/**
 * Create a tutor↔learner allocation. Validates against org membership that `tutorId` really is a
 * TUTOR and `learnerId` a STUDENT in THIS org — a client can never allocate an off-role pair. A
 * duplicate pair (DB UNIQUE) surfaces as 409. Audits allocation.created (ids only).
 */
export async function createTutorAllocation(
  orgId: string,
  actor: Actor,
  input: { tutorId: string; learnerId: string }
) {
  if (!actor.authenticated) {
    throw new AppError('Unauthorized', ErrorCodes.UNAUTHORIZED, 401);
  }
  const { tutorId, learnerId } = input;

  const [tutorRole, learnerRole] = await Promise.all([
    getOrgMemberRoleId(orgId, tutorId),
    getOrgMemberRoleId(orgId, learnerId)
  ]);

  if (tutorRole !== ROLE.TUTOR) {
    throw new AppError('The selected tutor is not a tutor in this organization', ErrorCodes.VALIDATION_ERROR, 400);
  }
  if (learnerRole !== ROLE.STUDENT) {
    throw new AppError('The selected learner is not a learner in this organization', ErrorCodes.VALIDATION_ERROR, 400);
  }

  let row;
  try {
    row = await createAllocation({ organizationId: orgId, tutorId, learnerId, createdBy: actor.userId });
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      throw new AppError('This tutor is already allocated to this learner', ErrorCodes.CONFLICT, 409);
    }
    throw error;
  }

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.ALLOCATION_CREATED,
    entityType: 'allocation',
    entityId: row.id,
    metadata: { tutorId, learnerId } // user ids only — never names/emails
  });

  return row;
}

/**
 * Remove (delete) an allocation, scoped to the org. Unknown id OR an allocation owned by another org
 * → 404 (don't reveal cross-org existence). Audits allocation.removed (ids only).
 */
export async function removeTutorAllocation(orgId: string, actor: Actor, allocationId: string) {
  const existing = await getAllocationById(allocationId);
  if (!existing || existing.organizationId !== orgId) {
    throw new AppError('Allocation not found', ErrorCodes.NOT_FOUND, 404);
  }

  const deleted = await deleteAllocationById(allocationId);

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.ALLOCATION_REMOVED,
    entityType: 'allocation',
    entityId: allocationId,
    metadata: { tutorId: existing.tutorId, learnerId: existing.learnerId }
  });

  return deleted;
}
