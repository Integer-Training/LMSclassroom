import * as schema from '@db/schema';

import { eq, sql } from 'drizzle-orm';

import { db } from '@db/drizzle';

// PII learner-profile queries — kept in their own module so it is obvious that this data is only
// ever read through the Admin-only endpoints. It is NEVER joined into any general serializer.

export type TLearnerProfile = typeof schema.learnerProfile.$inferSelect;

/** The nine nullable enrolment-PII fields (everything except id/userId/timestamps). */
export type LearnerProfileFields = {
  dateOfBirth: string | null;
  niNumber: string | null;
  gender: string | null;
  ethnicity: string | null;
  disability: string | null;
  address: string | null;
  aebRegion: string | null;
  collegeRef: string | null;
  notes: string | null;
};

export const LEARNER_PROFILE_FIELD_NAMES = [
  'date_of_birth',
  'ni_number',
  'gender',
  'ethnicity',
  'disability',
  'address',
  'aeb_region',
  'college_ref',
  'notes'
] as const;

export async function getLearnerProfileByUserId(userId: string): Promise<TLearnerProfile | null> {
  const [row] = await db.select().from(schema.learnerProfile).where(eq(schema.learnerProfile.userId, userId)).limit(1);
  return row ?? null;
}

/** Insert-or-update the 1:1 PII row for a user. */
export async function upsertLearnerProfile(userId: string, fields: LearnerProfileFields): Promise<TLearnerProfile> {
  const [row] = await db
    .insert(schema.learnerProfile)
    .values({ userId, ...fields })
    .onConflictDoUpdate({
      target: schema.learnerProfile.userId,
      set: { ...fields, updatedAt: sql`now()` }
    })
    .returning();
  return row;
}
