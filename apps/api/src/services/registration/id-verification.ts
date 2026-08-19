import { AppError, ErrorCodes } from '@api/utils/errors';
import type { Actor } from '@cio/db/actor';
import { isRole } from '@cio/utils/auth';
import {
  isAllowedIdVerificationStatus,
  isAllowedIdVerificationMethod,
  ID_VERIFICATION_STATUS_LABELS,
  ID_VERIFICATION_METHOD_LABELS,
  type IdVerificationStatus,
  type IdVerificationMethod
} from '@cio/utils/constants';
import { AUDIT_ACTIONS, recordAudit } from '@cio/db/audit';
import { getIdVerificationForLearner, upsertIdVerification } from '@cio/db/queries/id-verification';
import { isAllocatedTutor } from '@api/middlewares/guards/ownership';

// PearlLMS Phase 7 Step 4 — recording that a learner's identity was checked (docs/ONBOARDING-MODEL.md §3/§8,
// D2/D3). NO document is ever stored — who/when/method/note only. Recording is Manager/Admin OR the learner's
// allocated Tutor (isAllocatedTutor). The learner sees their OWN status (informational, self-only). This
// gates nothing — it never touches Phase-4 unlock.

function assertAuthed(actor: Actor): asserts actor is Extract<Actor, { authenticated: true }> {
  if (!actor.authenticated) throw new AppError('Unauthorized', ErrorCodes.UNAUTHORIZED, 401);
}

/** Manager/Admin anywhere; a Tutor only for a learner they are allocated to (D3). */
async function assertCanRecordFor(actor: Actor, learnerId: string): Promise<void> {
  assertAuthed(actor);
  if (isRole(actor, 'ADMIN', 'MANAGER')) return;
  if (isRole(actor, 'TUTOR') && (await isAllocatedTutor(actor, learnerId))) return;
  throw new AppError('You cannot record ID verification for this learner.', ErrorCodes.FORBIDDEN, 403);
}

export interface IdVerificationView {
  status: IdVerificationStatus;
  statusLabel: string;
  method: IdVerificationMethod | null;
  methodLabel: string | null;
  verifiedAt: string | null;
  verifiedBy: string | null;
  note: string | null;
  updatedAt: string | null;
}

function toView(row: Awaited<ReturnType<typeof getIdVerificationForLearner>>): IdVerificationView {
  const status = (row?.status ?? 'not_verified') as IdVerificationStatus;
  const method = (row?.method ?? null) as IdVerificationMethod | null;
  return {
    status,
    statusLabel: ID_VERIFICATION_STATUS_LABELS[status] ?? status,
    method,
    methodLabel: method ? (ID_VERIFICATION_METHOD_LABELS[method] ?? method) : null,
    verifiedAt: row?.verifiedAt ?? null,
    verifiedBy: row?.verifiedBy ?? null,
    note: row?.note ?? null,
    updatedAt: row?.updatedAt ?? null
  };
}

/** Staff view of a learner's full record (Manager/Admin or the allocated Tutor). */
export async function getLearnerIdVerification(actor: Actor, learnerId: string): Promise<IdVerificationView> {
  await assertCanRecordFor(actor, learnerId);
  return toView(await getIdVerificationForLearner(learnerId));
}

export interface RecordIdVerificationInput {
  status: string;
  method?: string | null;
  note?: string | null;
}

/** Record (upsert) a learner's ID verification. Manager/Admin or allocated Tutor. Audited (no note text). */
export async function recordIdVerification(
  actor: Actor,
  learnerId: string,
  input: RecordIdVerificationInput
): Promise<IdVerificationView> {
  await assertCanRecordFor(actor, learnerId);

  if (!isAllowedIdVerificationStatus(input.status)) {
    throw new AppError('Unknown verification status', ErrorCodes.VALIDATION_ERROR, 400, 'status');
  }
  const method = input.method ?? null;
  if (method !== null && !isAllowedIdVerificationMethod(method)) {
    throw new AppError('Unknown verification method', ErrorCodes.VALIDATION_ERROR, 400, 'method');
  }
  // A verified record carries a timestamp; a not-verified/failed record clears it.
  const verifiedAt = input.status === 'verified' ? new Date().toISOString() : null;

  const row = await upsertIdVerification(learnerId, {
    status: input.status,
    method,
    verifiedBy: (actor as Extract<Actor, { authenticated: true }>).userId,
    verifiedAt,
    note: input.note ?? null
  });

  // Audit: learner id + status + method label ONLY — never the free-text note.
  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.ID_VERIFICATION_RECORDED,
    entityType: 'id_verification',
    entityId: row.id,
    metadata: { learnerId, status: input.status, method: method ?? null }
  });

  return toView(row);
}

export interface MyIdVerification {
  status: IdVerificationStatus;
  verifiedAt: string | null;
}

/** The requesting learner's OWN status (informational, self-only). Exposes status + date, never note/verifier. */
export async function getMyIdVerification(actor: Actor): Promise<MyIdVerification> {
  assertAuthed(actor);
  const row = await getIdVerificationForLearner(actor.userId);
  const status = (row?.status ?? 'not_verified') as IdVerificationStatus;
  return { status, verifiedAt: status === 'verified' ? (row?.verifiedAt ?? null) : null };
}
