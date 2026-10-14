import * as schema from '@db/schema';

import { and, db, desc, eq } from '@db/drizzle';

// PearlLMS — periodic learner→tutor feedback ("every-N-units" popup, Feature 2). Read/write for the learner
// submission path, plus the admin-only org-wide read. The UNIQUE (learner_id, milestone) index is what makes
// a milestone's feedback idempotent and non-stacking. tutor_name is snapshotted on the row at submit, so the
// admin read never has to resolve a (possibly removed) tutor profile.

export type TutorFeedbackRow = typeof schema.tutorFeedback.$inferSelect;

export interface TutorFeedbackInsert {
  organizationId: string;
  learnerId: string;
  tutorId: string | null;
  tutorName: string;
  milestone: number;
  overallRating: number;
  communicationRating: number | null;
  helpfulnessRating: number | null;
  knowledgeRating: number | null;
  comment: string | null;
}

/** True if this learner has already submitted feedback for this exact milestone (drives "is it due?"). */
export async function hasTutorFeedback(learnerId: string, milestone: number): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.tutorFeedback.id })
    .from(schema.tutorFeedback)
    .where(and(eq(schema.tutorFeedback.learnerId, learnerId), eq(schema.tutorFeedback.milestone, milestone)))
    .limit(1);
  return !!row;
}

/**
 * Insert one feedback row, idempotently. The UNIQUE (learner_id, milestone) index means a duplicate submit
 * (double-click, or a re-prompt race) inserts nothing — `created` is then false and the caller returns 409.
 */
export async function insertTutorFeedback(
  input: TutorFeedbackInsert
): Promise<{ created: boolean; row: TutorFeedbackRow | null }> {
  const [row] = await db
    .insert(schema.tutorFeedback)
    .values(input)
    .onConflictDoNothing({ target: [schema.tutorFeedback.learnerId, schema.tutorFeedback.milestone] })
    .returning();
  return { created: !!row, row: row ?? null };
}

export interface OrgTutorFeedbackRow {
  id: string;
  learnerId: string;
  learnerName: string | null;
  tutorId: string | null;
  tutorName: string;
  milestone: number;
  overallRating: number;
  communicationRating: number | null;
  helpfulnessRating: number | null;
  knowledgeRating: number | null;
  comment: string | null;
  createdAt: string;
}

/** Every feedback row for an org, newest first, with the learner's current name (tutor name is on the row). */
export async function getOrgTutorFeedback(orgId: string): Promise<OrgTutorFeedbackRow[]> {
  const rows = await db
    .select({
      id: schema.tutorFeedback.id,
      learnerId: schema.tutorFeedback.learnerId,
      learnerName: schema.profile.fullname,
      tutorId: schema.tutorFeedback.tutorId,
      tutorName: schema.tutorFeedback.tutorName,
      milestone: schema.tutorFeedback.milestone,
      overallRating: schema.tutorFeedback.overallRating,
      communicationRating: schema.tutorFeedback.communicationRating,
      helpfulnessRating: schema.tutorFeedback.helpfulnessRating,
      knowledgeRating: schema.tutorFeedback.knowledgeRating,
      comment: schema.tutorFeedback.comment,
      createdAt: schema.tutorFeedback.createdAt
    })
    .from(schema.tutorFeedback)
    .leftJoin(schema.profile, eq(schema.profile.id, schema.tutorFeedback.learnerId))
    .where(eq(schema.tutorFeedback.organizationId, orgId))
    .orderBy(desc(schema.tutorFeedback.createdAt));
  return rows as OrgTutorFeedbackRow[];
}
