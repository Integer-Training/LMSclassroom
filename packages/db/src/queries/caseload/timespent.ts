import * as schema from '@db/schema';

import { db, inArray, sql, type DbOrTxClient } from '@db/drizzle';

// PearlLMS Phase 9 — accumulated active time per (learner, unit). Written by the lesson-view heartbeat
// (wall-clock-capped in the service), read by the tutor progression view for per-unit + per-course time.

export interface UnitTimeRow {
  learnerId: string;
  courseId: string;
  lessonId: string;
  seconds: number;
}

/**
 * Atomically add `seconds` to a learner's time on a unit (upsert += via ON CONFLICT). Concurrent beats
 * accumulate safely. The service caps each beat before calling this.
 */
export async function addUnitTimeSpent(
  input: { learnerId: string; courseId: string; lessonId: string; seconds: number },
  client: DbOrTxClient = db
): Promise<void> {
  await client
    .insert(schema.unitTimeSpent)
    .values({
      learnerId: input.learnerId,
      courseId: input.courseId,
      lessonId: input.lessonId,
      seconds: input.seconds
    })
    .onConflictDoUpdate({
      target: [schema.unitTimeSpent.learnerId, schema.unitTimeSpent.lessonId],
      set: {
        seconds: sql`${schema.unitTimeSpent.seconds} + ${input.seconds}`,
        updatedAt: sql`now()`
      }
    });
}

/** All per-unit time rows for a set of learners (roster-scoped by the caller) — feeds per-unit + per-course sums. */
export async function getUnitTimeForLearners(learnerIds: string[], client: DbOrTxClient = db): Promise<UnitTimeRow[]> {
  if (learnerIds.length === 0) return [];
  const rows = await client
    .select({
      learnerId: schema.unitTimeSpent.learnerId,
      courseId: schema.unitTimeSpent.courseId,
      lessonId: schema.unitTimeSpent.lessonId,
      seconds: schema.unitTimeSpent.seconds
    })
    .from(schema.unitTimeSpent)
    .where(inArray(schema.unitTimeSpent.learnerId, learnerIds));
  return rows.map((r) => ({
    learnerId: r.learnerId,
    courseId: r.courseId,
    lessonId: r.lessonId,
    seconds: Number(r.seconds)
  }));
}
