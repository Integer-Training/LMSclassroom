import * as schema from '@db/schema';

import { and, db, eq, like, sql, inArray, type DbOrTxClient } from '@db/drizzle';

// PearlLMS Phase 9 — accumulated active time per (learner, unit). Written by the lesson-view heartbeat
// (wall-clock-capped in the service), read by the tutor progression view for per-unit + per-course time.
// Also maintains a monthly-bucketed mirror (unit_time_monthly) so the learner home can chart study hours
// over time (the per-unit row is only a running total with no history).

export interface UnitTimeRow {
  learnerId: string;
  courseId: string;
  lessonId: string;
  seconds: number;
}

export interface MonthlyStudyRow {
  yearMonth: string; // 'YYYY-MM'
  seconds: number;
}

/** UTC 'YYYY-MM' for the given instant (default now) — the month bucket key. */
function utcYearMonth(at: Date = new Date()): string {
  return at.toISOString().slice(0, 7);
}

/**
 * Atomically add `seconds` to a learner's time on a unit (upsert += via ON CONFLICT). Concurrent beats
 * accumulate safely. The service caps each beat before calling this. Also increments the current UTC
 * month's bucket (unit_time_monthly) so study-hours-over-time is chartable — best-effort, and independent
 * of the running total so one failing never blocks the other.
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

  // Best-effort per the contract: a failure here (e.g. the table not yet migrated, or a transient error)
  // must never fail an otherwise-good time beat, and the running total above has already committed.
  try {
    await client
      .insert(schema.unitTimeMonthly)
      .values({
        learnerId: input.learnerId,
        courseId: input.courseId,
        yearMonth: utcYearMonth(),
        seconds: input.seconds
      })
      .onConflictDoUpdate({
        target: [schema.unitTimeMonthly.learnerId, schema.unitTimeMonthly.courseId, schema.unitTimeMonthly.yearMonth],
        set: {
          seconds: sql`${schema.unitTimeMonthly.seconds} + ${input.seconds}`,
          updatedAt: sql`now()`
        }
      });
  } catch {
    /* monthly bucket is a chart convenience; the authoritative running total already recorded */
  }
}

/**
 * A learner's monthly study seconds for one calendar YEAR, summed across all their courses. Rows only exist
 * for months with recorded time; the caller fills the missing months with zero for the chart.
 */
export async function getMonthlyStudyForLearner(
  learnerId: string,
  year: number,
  client: DbOrTxClient = db
): Promise<MonthlyStudyRow[]> {
  const rows = await client
    .select({
      yearMonth: schema.unitTimeMonthly.yearMonth,
      seconds: sql<number>`sum(${schema.unitTimeMonthly.seconds})`
    })
    .from(schema.unitTimeMonthly)
    .where(
      and(eq(schema.unitTimeMonthly.learnerId, learnerId), like(schema.unitTimeMonthly.yearMonth, `${year}-%`))
    )
    .groupBy(schema.unitTimeMonthly.yearMonth);
  return rows.map((r) => ({ yearMonth: r.yearMonth, seconds: Number(r.seconds) }));
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
