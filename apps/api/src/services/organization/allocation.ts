import { randomUUID } from 'crypto';

import { AppError, ErrorCodes } from '@api/utils/errors';
import type { Actor } from '@cio/db/actor';
import { recordAudit, AUDIT_ACTIONS } from '@cio/db/audit';
import { runInTransaction } from '@cio/db/drizzle';
import { deriveCaseloadState, ROLE } from '@cio/utils/constants';
import { isUniqueConstraintViolation } from '@cio/utils/errors';
import {
  createAllocation,
  deleteAllocationById,
  getAllocationById,
  getOrgMemberRoleAndStatus,
  getOrgMemberRoleId,
  listAllocationsPageByOrg,
  listLearnersForTutor,
  moveAllocationsTx,
  searchAssignablePeople,
  type ListAllocationsPageOptions
} from '@cio/db/queries/allocation';
import { getSubmissionStatusRowsForLearners } from '@cio/db/queries/coursework';
import { archiveThreadForPair, markTutorNotificationsReadForLearners } from '@cio/db/queries/comms';

// Tutor↔learner allocation management (PearlLMS Phase 3). Manager/Admin only — enforced at the route
// (requireManagerOrAdmin). Every mutation validates roles against the org membership (never trust the
// client's word) and audits with USER IDS ONLY — no names/emails in metadata.

/** One page of the org's allocations (the Manager/Admin table), with tutor + learner display names. */
export async function listOrgAllocations(orgId: string, query: ListAllocationsPageOptions = {}) {
  return listAllocationsPageByOrg(orgId, query);
}

export interface AssignablePerson {
  userId: string;
  name: string;
  email: string;
}

/**
 * Typeahead for the allocation pickers (Manager/Admin surface): ACTIVE tutors OR learners in the org matching
 * `search`, capped at 20, hiding people already paired with the counterpart already chosen in the form.
 */
export async function searchAssignablePeopleForOrg(
  orgId: string,
  input: { role: 'tutor' | 'learner'; search?: string; excludePairedWith?: string; limit?: number }
): Promise<AssignablePerson[]> {
  return searchAssignablePeople(orgId, {
    role: input.role === 'tutor' ? ROLE.TUTOR : ROLE.STUDENT,
    search: input.search,
    excludePairedWith: input.excludePairedWith,
    limit: input.limit ?? 20
  });
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

  const [tutor, learnerRole] = await Promise.all([
    getOrgMemberRoleAndStatus(orgId, tutorId),
    getOrgMemberRoleId(orgId, learnerId)
  ]);

  if (tutor?.roleId !== ROLE.TUTOR) {
    throw new AppError('The selected tutor is not a tutor in this organization', ErrorCodes.VALIDATION_ERROR, 400);
  }
  if (tutor.status !== 'ACTIVE') {
    throw new AppError('The selected tutor is not active', ErrorCodes.VALIDATION_ERROR, 400);
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

  // Phase 6 (D4): de-allocation flips the pair's message thread READ-ONLY (archived), preserving history
  // without deleting it — the participants can still read it, but not write, and a new tutor starts a fresh
  // thread. Best-effort: a messaging failure must not fail the allocation removal.
  try {
    await archiveThreadForPair(existing.tutorId, existing.learnerId);
  } catch (error) {
    console.error('[allocation] failed to archive message thread on de-allocation (allocation still removed):', error);
  }

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.ALLOCATION_REMOVED,
    entityType: 'allocation',
    entityId: allocationId,
    metadata: { tutorId: existing.tutorId, learnerId: existing.learnerId }
  });

  return deleted;
}

/** The incoming tutor must be an ACTIVE tutor of this org (the outgoing tutor is deliberately NOT status-checked). */
async function assertActiveTutor(orgId: string, tutorId: string): Promise<void> {
  const tutor = await getOrgMemberRoleAndStatus(orgId, tutorId);
  if (tutor?.roleId !== ROLE.TUTOR) {
    throw new AppError('The selected tutor is not a tutor in this organization', ErrorCodes.VALIDATION_ERROR, 400);
  }
  if (tutor.status !== 'ACTIVE') {
    throw new AppError('The selected tutor is not active', ErrorCodes.VALIDATION_ERROR, 400);
  }
}

/**
 * Switch ONE learner from tutor A to tutor B atomically (no unallocated window; a co-tutor is kept). A is not
 * status-checked — a deactivated tutor leaving is the main use case. 0 rows removed (already changed / double
 * click) → 409. After commit, best-effort: clear A's bell items about the learner, then audit
 * `allocation.switched` (ids + outcome + optional reason; never names). Outcome `switched`, or `removed_only`
 * when B was already a co-tutor.
 */
export async function switchTutorForLearner(
  orgId: string,
  actor: Actor,
  input: { learnerId: string; fromTutorId: string; toTutorId: string; reason?: string }
): Promise<{ outcome: 'switched' | 'removed_only'; allocationId: string | null }> {
  if (!actor.authenticated) {
    throw new AppError('Unauthorized', ErrorCodes.UNAUTHORIZED, 401);
  }
  const { learnerId, fromTutorId, toTutorId, reason } = input;
  if (fromTutorId === toTutorId) {
    throw new AppError('Choose a different tutor to switch to', ErrorCodes.VALIDATION_ERROR, 400);
  }
  if ((await getOrgMemberRoleId(orgId, learnerId)) !== ROLE.STUDENT) {
    throw new AppError('Learner not found', ErrorCodes.NOT_FOUND, 404);
  }
  await assertActiveTutor(orgId, toTutorId);

  const result = await runInTransaction((tx) =>
    moveAllocationsTx(tx, {
      organizationId: orgId,
      fromTutorId,
      toTutorId,
      learnerIds: [learnerId],
      createdBy: actor.userId
    })
  );
  if (result.moved.length === 0 && result.alreadyWithTarget.length === 0) {
    throw new AppError('This learner is no longer with that tutor — refresh and try again', ErrorCodes.CONFLICT, 409);
  }
  const outcome = result.moved.length > 0 ? 'switched' : 'removed_only';

  // Best-effort side effects — the switch is already committed and must not fail because of them.
  try {
    await markTutorNotificationsReadForLearners(fromTutorId, [learnerId]);
  } catch (error) {
    console.error('[allocation] failed to clear the previous tutor notifications (switch still done):', error);
  }
  try {
    await recordAudit({
      actor,
      action: AUDIT_ACTIONS.ALLOCATION_SWITCHED,
      entityType: 'allocation',
      entityId: result.moved[0]?.allocationId ?? learnerId,
      metadata: { learnerId, fromTutorId, toTutorId, outcome, ...(reason ? { reason } : {}) }
    });
  } catch (error) {
    console.error('[allocation] failed to audit the switch (switch still done):', error);
  }

  return { outcome, allocationId: result.moved[0]?.allocationId ?? null };
}

export type MoveLearnerOutcome = 'moved' | 'alreadyWithTarget' | 'notAllocated';

/**
 * Bulk move: hand chosen learners (or ALL) from tutor A to tutor B in ONE all-or-nothing transaction. B is
 * validated once. Per-learner results: moved / alreadyWithTarget (B was already a co-tutor) / notAllocated
 * (not with A any more). After commit, best-effort: a set-based notification clear, then one audit row per
 * learner sharing a `batchId`.
 */
export async function moveLearnersBetweenTutors(
  orgId: string,
  actor: Actor,
  input: { fromTutorId: string; toTutorId: string; learnerIds?: string[]; all?: boolean; reason?: string }
): Promise<{
  batchId: string;
  moved: number;
  alreadyWithTarget: number;
  notAllocated: number;
  results: { learnerId: string; outcome: MoveLearnerOutcome }[];
}> {
  if (!actor.authenticated) {
    throw new AppError('Unauthorized', ErrorCodes.UNAUTHORIZED, 401);
  }
  const { fromTutorId, toTutorId, reason } = input;
  if (fromTutorId === toTutorId) {
    throw new AppError('Choose a different tutor to move learners to', ErrorCodes.VALIDATION_ERROR, 400);
  }
  const requested = input.all ? 'all' : [...new Set(input.learnerIds ?? [])];
  if (requested !== 'all' && requested.length === 0) {
    throw new AppError('Select at least one learner', ErrorCodes.VALIDATION_ERROR, 400);
  }
  await assertActiveTutor(orgId, toTutorId);

  const result = await runInTransaction((tx) =>
    moveAllocationsTx(tx, {
      organizationId: orgId,
      fromTutorId,
      toTutorId,
      learnerIds: requested,
      createdBy: actor.userId
    })
  );

  const outcomes = new Map<string, MoveLearnerOutcome>();
  for (const m of result.moved) outcomes.set(m.learnerId, 'moved');
  for (const id of result.alreadyWithTarget) outcomes.set(id, 'alreadyWithTarget');
  if (requested !== 'all') for (const id of requested) if (!outcomes.has(id)) outcomes.set(id, 'notAllocated');
  const results = [...outcomes].map(([learnerId, outcome]) => ({ learnerId, outcome }));
  const batchId = randomUUID();
  const removedIds = results.filter((r) => r.outcome !== 'notAllocated').map((r) => r.learnerId);

  try {
    await markTutorNotificationsReadForLearners(fromTutorId, removedIds);
  } catch (error) {
    console.error('[allocation] failed to clear the previous tutor notifications (move still done):', error);
  }
  const allocationIdByLearner = new Map(result.moved.map((m) => [m.learnerId, m.allocationId] as const));
  for (const r of results) {
    if (r.outcome === 'notAllocated') continue;
    try {
      await recordAudit({
        actor,
        action: AUDIT_ACTIONS.ALLOCATION_SWITCHED,
        entityType: 'allocation',
        entityId: allocationIdByLearner.get(r.learnerId) ?? r.learnerId,
        metadata: {
          learnerId: r.learnerId,
          fromTutorId,
          toTutorId,
          outcome: r.outcome === 'moved' ? 'switched' : 'removed_only',
          batchId,
          ...(reason ? { reason } : {})
        }
      });
    } catch (error) {
      console.error('[allocation] failed to audit a bulk move row (move still done):', error);
    }
  }

  return {
    batchId,
    moved: results.filter((r) => r.outcome === 'moved').length,
    alreadyWithTarget: results.filter((r) => r.outcome === 'alreadyWithTarget').length,
    notAllocated: results.filter((r) => r.outcome === 'notAllocated').length,
    results
  };
}

export interface TutorLearnerForMove {
  learnerId: string;
  name: string | null;
  email: string | null;
  /** Courses' units whose latest version is unmarked — what the incoming tutor inherits to mark. */
  awaitingMarking: number;
}

/** The full learner list of ONE tutor (the Move dialog), each with their awaiting-marking unit count. */
export async function listTutorLearnersForMove(orgId: string, tutorId: string): Promise<TutorLearnerForMove[]> {
  const tutor = await getOrgMemberRoleAndStatus(orgId, tutorId);
  if (tutor?.roleId !== ROLE.TUTOR) {
    throw new AppError('Tutor not found', ErrorCodes.NOT_FOUND, 404);
  }
  const roster = await listLearnersForTutor(tutorId);
  const subs = await getSubmissionStatusRowsForLearners(roster.map((l) => l.learnerId));
  const awaiting = new Map<string, number>();
  const latest = new Map<string, (typeof subs)[number]>();
  for (const s of subs) {
    const key = `${s.learnerId}::${s.lessonId}`;
    const cur = latest.get(key);
    if (!cur || s.version > cur.version) latest.set(key, s);
  }
  for (const s of latest.values()) {
    if (deriveCaseloadState(s.result).awaitingMarking) awaiting.set(s.learnerId, (awaiting.get(s.learnerId) ?? 0) + 1);
  }
  return roster.map((l) => ({
    learnerId: l.learnerId,
    name: l.name,
    email: l.email,
    awaitingMarking: awaiting.get(l.learnerId) ?? 0
  }));
}
