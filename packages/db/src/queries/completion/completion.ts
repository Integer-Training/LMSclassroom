import * as schema from '@db/schema';

import { and, db, desc, eq, sql, type DbOrTxClient } from '@db/drizzle';
import { isExemptUnitType, isPassingResult } from '@cio/utils/constants';
import { getOrderedUnitsForCourse } from '../gating';
import { hasLearnerPassedUnit } from '../coursework';

// PearlLMS Phase 5 Step 2 — completion RULE, idempotent record, and backfill (docs/PROGRESS-MODEL.md §1-2).
// The rule is the ONE authority: completion = every NON-EXEMPT unit of the course has a passing latest
// marked result (Phase-3 hasLearnerPassedUnit). Exempt units (induction / id-check) sit outside the rule
// AND the denominator. It is independent of sequential_unlock — an unlock-off course uses the same test.
// All reads accept an optional tx client so the trigger can evaluate INSIDE the result's transaction and
// see the just-recorded Pass (read-your-writes). No stored "complete" bit is ever trusted as the boolean —
// this recomputes from live results; the course_completion row is the durable timestamped milestone.

export interface CompletionRow {
  id: string;
  learnerId: string;
  courseId: string;
  completedAt: string;
  createdAt: string;
}

/**
 * Is this course complete for this learner? True iff the course has at least one non-exempt unit AND every
 * non-exempt unit has a passing latest marked result. A course with zero non-exempt units (e.g. induction
 * only) is NOT completable (empty denominator). Reads via `client` so it can run inside the result tx.
 */
export async function isCourseComplete(
  learnerId: string,
  courseId: string,
  client: DbOrTxClient = db
): Promise<boolean> {
  const units = await getOrderedUnitsForCourse(courseId, client);
  const required = units.filter((u) => !isExemptUnitType(u.unitType));
  if (required.length === 0) return false;
  for (const u of required) {
    if (!(await hasLearnerPassedUnit(learnerId, u.lessonId, client))) return false;
  }
  return true;
}

/** The completion record for a learner+course, or null. */
export async function getCourseCompletion(
  learnerId: string,
  courseId: string,
  client: DbOrTxClient = db
): Promise<CompletionRow | null> {
  const [row] = await client
    .select()
    .from(schema.courseCompletion)
    .where(and(eq(schema.courseCompletion.learnerId, learnerId), eq(schema.courseCompletion.courseId, courseId)))
    .limit(1);
  return (row as CompletionRow) ?? null;
}

export interface InsertCompletionInput {
  learnerId: string;
  courseId: string;
  completedAt: string;
}

/**
 * Idempotent check-and-insert: INSERT ... ON CONFLICT (learner, course) DO NOTHING. If a row is returned it
 * was newly inserted (inserted: true); an empty returning means the row already existed — we fetch and
 * return it (inserted: false). The UNIQUE(learner, course) constraint is the durable backstop: a re-mark, a
 * concurrent double-fire, or a backfill re-run can never create a second row or move completed_at.
 */
export async function insertCompletionIfAbsent(
  client: DbOrTxClient,
  input: InsertCompletionInput
): Promise<{ inserted: boolean; row: CompletionRow | null }> {
  const [row] = await client
    .insert(schema.courseCompletion)
    .values(input)
    .onConflictDoNothing({
      target: [schema.courseCompletion.learnerId, schema.courseCompletion.courseId]
    })
    .returning();
  if (row) return { inserted: true, row: row as CompletionRow };
  const existing = await getCourseCompletion(input.learnerId, input.courseId, client);
  return { inserted: false, row: existing };
}

/**
 * The completion TRIGGER primitive: if the course is now complete for the learner, idempotently record it.
 * Returns the row ONLY when it was newly inserted (so the caller audits `completion.recorded` exactly once);
 * returns null when the course is not complete OR the record already existed. Runs entirely on `client` — in
 * the live path this is the tx from recordResult, so it is atomic with the completing result.
 */
export async function recordCompletionIfComplete(
  client: DbOrTxClient,
  input: InsertCompletionInput
): Promise<CompletionRow | null> {
  if (!(await isCourseComplete(input.learnerId, input.courseId, client))) return null;
  const { inserted, row } = await insertCompletionIfAbsent(client, input);
  return inserted ? row : null;
}

/**
 * Best-effort completion timestamp for a historical (backfill) record: the MAX recorded_at across the
 * learner's passing results in the course — i.e. when the last required Pass was entered. Null if none
 * (caller falls back to now()). Only counts results whose value is passing (config), so a Refer never
 * moves the timestamp.
 */
export async function getMaxPassingResultRecordedAt(
  learnerId: string,
  courseId: string,
  client: DbOrTxClient = db
): Promise<string | null> {
  const rows = await client
    .select({ result: schema.courseworkResult.result, recordedAt: schema.courseworkResult.recordedAt })
    .from(schema.courseworkResult)
    .innerJoin(schema.courseworkSubmission, eq(schema.courseworkSubmission.id, schema.courseworkResult.submissionId))
    .where(
      and(eq(schema.courseworkSubmission.learnerId, learnerId), eq(schema.courseworkSubmission.courseId, courseId))
    )
    .orderBy(desc(schema.courseworkResult.recordedAt));
  const passing = rows.find((r) => isPassingResult(r.result));
  return passing ? (passing.recordedAt as string) : null;
}

/** Distinct (learner, course) enrolments for STUDENT group members — the backfill's scan list. */
export async function listEnrolledLearnerCourses(
  client: DbOrTxClient = db
): Promise<{ learnerId: string; courseId: string }[]> {
  const rows = await client
    .select({ learnerId: schema.groupmember.profileId, courseId: schema.course.id })
    .from(schema.groupmember)
    .innerJoin(schema.group, eq(schema.group.id, schema.groupmember.groupId))
    .innerJoin(schema.course, eq(schema.course.groupId, schema.group.id))
    .where(and(eq(schema.groupmember.roleId, 3), sql`${schema.groupmember.profileId} is not null`))
    .groupBy(schema.groupmember.profileId, schema.course.id);
  return rows
    .filter((r): r is { learnerId: string; courseId: string } => !!r.learnerId && !!r.courseId)
    .map((r) => ({ learnerId: r.learnerId as string, courseId: r.courseId }));
}

export interface BackfillReport {
  scanned: number;
  newlyRecorded: number;
  alreadyRecorded: number;
  skippedIncomplete: number;
  insertedIds: string[];
}

export interface BackfillDeps {
  listEnrollments?: () => Promise<{ learnerId: string; courseId: string }[]>;
  isComplete?: (learnerId: string, courseId: string) => Promise<boolean>;
  completedAtFor?: (learnerId: string, courseId: string) => Promise<string | null>;
  insertIfAbsent?: (input: InsertCompletionInput) => Promise<{ inserted: boolean; row: CompletionRow | null }>;
  onAudit?: (row: CompletionRow, learnerId: string, courseId: string) => Promise<void>;
  now?: () => string;
}

/**
 * One-off backfill: for every existing enrolment already satisfying the completion rule, insert the missing
 * record — through the SAME rule code (isCourseComplete) and the SAME idempotent insert as the live trigger.
 * Existing rows are skipped; incomplete enrolments are skipped; a genuine new insert fires onAudit. Returns
 * a PII-free counts+ids report for the step log. Collaborators are injectable for unit testing; the defaults
 * wire the real queries.
 */
export async function backfillCompletions(deps: BackfillDeps = {}): Promise<BackfillReport> {
  const listEnrollments = deps.listEnrollments ?? (() => listEnrolledLearnerCourses());
  const isComplete = deps.isComplete ?? ((l: string, c: string) => isCourseComplete(l, c));
  const completedAtFor = deps.completedAtFor ?? ((l: string, c: string) => getMaxPassingResultRecordedAt(l, c));
  const insertIfAbsent = deps.insertIfAbsent ?? ((input: InsertCompletionInput) => insertCompletionIfAbsent(db, input));
  const now = deps.now ?? (() => new Date().toISOString());

  const report: BackfillReport = {
    scanned: 0,
    newlyRecorded: 0,
    alreadyRecorded: 0,
    skippedIncomplete: 0,
    insertedIds: []
  };

  const enrollments = await listEnrollments();
  for (const { learnerId, courseId } of enrollments) {
    report.scanned++;
    if (!(await isComplete(learnerId, courseId))) {
      report.skippedIncomplete++;
      continue;
    }
    const completedAt = (await completedAtFor(learnerId, courseId)) ?? now();
    const { inserted, row } = await insertIfAbsent({ learnerId, courseId, completedAt });
    if (inserted && row) {
      report.newlyRecorded++;
      report.insertedIds.push(row.id);
      if (deps.onAudit) await deps.onAudit(row, learnerId, courseId);
    } else {
      report.alreadyRecorded++;
    }
  }

  return report;
}
