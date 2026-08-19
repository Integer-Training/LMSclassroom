import * as schema from '@db/schema';

import { db, eq, type DbOrTxClient } from '@db/drizzle';

// PearlLMS Phase 7 Step 4 — the learner identity-verification record (docs/ONBOARDING-MODEL.md §3). One row per
// learner (unique learner_id), upserted. NO document/file column exists — who/when/method/note only.

export interface IdVerificationRow {
  id: string;
  learnerId: string;
  status: string;
  method: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  note: string | null;
  updatedAt: string;
}

export interface IdVerificationUpsert {
  status: string;
  method?: string | null;
  verifiedBy: string;
  verifiedAt?: string | null;
  note?: string | null;
}

/** The learner's current record, or null if none has been recorded yet. */
export async function getIdVerificationForLearner(
  learnerId: string,
  client: DbOrTxClient = db
): Promise<IdVerificationRow | null> {
  const [row] = await client
    .select()
    .from(schema.idVerification)
    .where(eq(schema.idVerification.learnerId, learnerId))
    .limit(1);
  return row
    ? {
        id: row.id,
        learnerId: row.learnerId,
        status: row.status,
        method: row.method ?? null,
        verifiedBy: row.verifiedBy ?? null,
        verifiedAt: row.verifiedAt ?? null,
        note: row.note ?? null,
        updatedAt: row.updatedAt
      }
    : null;
}

/** Insert or update the learner's single verification record (upsert on learner_id). */
export async function upsertIdVerification(
  learnerId: string,
  input: IdVerificationUpsert,
  client: DbOrTxClient = db
): Promise<IdVerificationRow> {
  const values = {
    learnerId,
    status: input.status,
    method: input.method ?? null,
    verifiedBy: input.verifiedBy,
    verifiedAt: input.verifiedAt ?? null,
    note: input.note ?? null,
    updatedAt: new Date().toISOString()
  };
  const [row] = await client
    .insert(schema.idVerification)
    .values(values)
    .onConflictDoUpdate({
      target: schema.idVerification.learnerId,
      set: {
        status: values.status,
        method: values.method,
        verifiedBy: values.verifiedBy,
        verifiedAt: values.verifiedAt,
        note: values.note,
        updatedAt: values.updatedAt
      }
    })
    .returning();
  return {
    id: row.id,
    learnerId: row.learnerId,
    status: row.status,
    method: row.method ?? null,
    verifiedBy: row.verifiedBy ?? null,
    verifiedAt: row.verifiedAt ?? null,
    note: row.note ?? null,
    updatedAt: row.updatedAt
  };
}
