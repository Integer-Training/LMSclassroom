import * as schema from '@db/schema';

import { and, asc, db, eq, type DbOrTxClient } from '@db/drizzle';
import { isAllowedRegistrationStatus, type RegistrationStatus } from '@cio/utils/constants';

// PearlLMS Phase 7 — read/write queries for the public registration intake (docs/ONBOARDING-MODEL.md §3).
// A registration is a PENDING APPLICATION; these queries only touch the `registration` table — never the auth
// stack, never a user/session. Approval/rejection queries land with the Step-3 queue.

export interface NewRegistration {
  organizationId: string;
  fullName: string;
  email: string; // caller passes it already lowercased + trimmed
  requestedCourseId?: string | null;
}

export interface RegistrationRow {
  id: string;
  organizationId: string;
  fullName: string;
  email: string;
  requestedCourseId: string | null;
  status: string;
  createdAt: string;
}

/** Insert a pending registration (status defaults to 'pending', created_at = submitted_at). */
export async function insertRegistration(input: NewRegistration, client: DbOrTxClient = db): Promise<RegistrationRow> {
  const [row] = await client
    .insert(schema.registration)
    .values({
      organizationId: input.organizationId,
      fullName: input.fullName,
      email: input.email,
      requestedCourseId: input.requestedCourseId ?? null
    })
    .returning();
  return {
    id: row.id,
    organizationId: row.organizationId,
    fullName: row.fullName,
    email: row.email,
    requestedCourseId: row.requestedCourseId ?? null,
    status: row.status,
    createdAt: row.createdAt
  };
}

/**
 * Is there already an OPEN (pending) registration for this email in the org? Used for the duplicate-email
 * refusal (docs §9). A prior approved/rejected registration does NOT block a fresh application.
 */
export async function hasOpenRegistrationForEmail(
  organizationId: string,
  email: string,
  client: DbOrTxClient = db
): Promise<boolean> {
  const rows = await client
    .select({ id: schema.registration.id })
    .from(schema.registration)
    .where(
      and(
        eq(schema.registration.organizationId, organizationId),
        eq(schema.registration.email, email.toLowerCase().trim()),
        eq(schema.registration.status, 'pending')
      )
    )
    .limit(1);
  return rows.length > 0;
}

export interface RegistrationQueueRow {
  id: string;
  fullName: string;
  email: string;
  requestedCourseId: string | null;
  requestedCourseTitle: string | null;
  status: string;
  decisionNote: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
}

function mapQueueRow(r: {
  id: string;
  fullName: string;
  email: string;
  requestedCourseId: string | null;
  requestedCourseTitle: string | null;
  status: string;
  decisionNote: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
}): RegistrationQueueRow {
  return { ...r };
}

/**
 * The approval queue for an org (docs/ONBOARDING-MODEL.md §4). Oldest-first (longest-waiting on top). Optional
 * status filter — `pending` for the working queue, `approved`/`rejected` for the decided record. The requested
 * course TITLE is joined for display; the applicant's email is included (staff-only surface).
 */
export async function listRegistrations(
  organizationId: string,
  status?: RegistrationStatus,
  client: DbOrTxClient = db
): Promise<RegistrationQueueRow[]> {
  const conds = [eq(schema.registration.organizationId, organizationId)];
  if (status && isAllowedRegistrationStatus(status)) conds.push(eq(schema.registration.status, status));
  const rows = await client
    .select({
      id: schema.registration.id,
      fullName: schema.registration.fullName,
      email: schema.registration.email,
      requestedCourseId: schema.registration.requestedCourseId,
      requestedCourseTitle: schema.course.title,
      status: schema.registration.status,
      decisionNote: schema.registration.decisionNote,
      decidedBy: schema.registration.decidedBy,
      decidedAt: schema.registration.decidedAt,
      createdAt: schema.registration.createdAt
    })
    .from(schema.registration)
    .leftJoin(schema.course, eq(schema.course.id, schema.registration.requestedCourseId))
    .where(and(...conds))
    .orderBy(asc(schema.registration.createdAt)); // oldest-first
  return rows.map(mapQueueRow);
}

/** A single registration (org-scoped) for the detail view. */
export async function getRegistrationById(
  organizationId: string,
  id: string,
  client: DbOrTxClient = db
): Promise<RegistrationQueueRow | null> {
  const [row] = await client
    .select({
      id: schema.registration.id,
      fullName: schema.registration.fullName,
      email: schema.registration.email,
      requestedCourseId: schema.registration.requestedCourseId,
      requestedCourseTitle: schema.course.title,
      status: schema.registration.status,
      decisionNote: schema.registration.decisionNote,
      decidedBy: schema.registration.decidedBy,
      decidedAt: schema.registration.decidedAt,
      createdAt: schema.registration.createdAt
    })
    .from(schema.registration)
    .leftJoin(schema.course, eq(schema.course.id, schema.registration.requestedCourseId))
    .where(and(eq(schema.registration.organizationId, organizationId), eq(schema.registration.id, id)))
    .limit(1);
  return row ? mapQueueRow(row) : null;
}

export interface RegistrationDecision {
  status: 'approved' | 'rejected';
  decidedBy: string;
  decidedAt: string;
  decisionNote?: string | null;
}

/**
 * Atomic compare-and-swap: flip a registration from `pending` to a decided state ONLY if it is still pending.
 * The `WHERE status = 'pending'` predicate + the row lock this UPDATE takes make it the one-way + race-safe
 * primitive — a second concurrent decision blocks on the lock, then matches zero rows (no longer pending) and
 * returns null, so exactly one decision wins. MUST be called inside a transaction (pass the tx `client`) so a
 * downstream failure (e.g. onboarding) rolls the flip back.
 */
export async function claimPendingRegistration(
  client: DbOrTxClient,
  organizationId: string,
  id: string,
  decision: RegistrationDecision
): Promise<RegistrationRow | null> {
  const [row] = await client
    .update(schema.registration)
    .set({
      status: decision.status,
      decidedBy: decision.decidedBy,
      decidedAt: decision.decidedAt,
      decisionNote: decision.decisionNote ?? null
    })
    .where(
      and(
        eq(schema.registration.id, id),
        eq(schema.registration.organizationId, organizationId),
        eq(schema.registration.status, 'pending')
      )
    )
    .returning();
  return row
    ? {
        id: row.id,
        organizationId: row.organizationId,
        fullName: row.fullName,
        email: row.email,
        requestedCourseId: row.requestedCourseId ?? null,
        status: row.status,
        createdAt: row.createdAt
      }
    : null;
}
