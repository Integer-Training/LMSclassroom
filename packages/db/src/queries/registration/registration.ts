import * as schema from '@db/schema';

import { and, db, eq, type DbOrTxClient } from '@db/drizzle';

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
