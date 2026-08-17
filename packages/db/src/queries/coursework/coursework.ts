import * as schema from '@db/schema';

import { and, db, desc, eq, inArray, sql, type DbOrTxClient } from '@db/drizzle';
import { isPassingResult } from '@cio/utils/constants';

// Learner coursework submissions (PearlLMS Phase 3 Step 4). A submission is a learner's upload against
// one unit, versioned (1-based per learner+unit); history is retained (rows are never deleted). These
// are the MOST sensitive objects in the system — every read is gated by canReadCoursework at the guard
// layer; these queries do no access control of their own.

export interface CourseworkFile {
  key: string;
  name: string;
  size?: number;
  type?: string;
}

export interface CourseworkSubmissionRow {
  id: string;
  learnerId: string;
  courseId: string;
  lessonId: string;
  version: number;
  files: CourseworkFile[];
  status: string;
  submittedAt: string;
}

/** The next 1-based version for this learner+unit (max existing + 1). */
export async function getNextSubmissionVersion(learnerId: string, lessonId: string): Promise<number> {
  const [row] = await db
    .select({ max: sql<number>`coalesce(max(${schema.courseworkSubmission.version}), 0)` })
    .from(schema.courseworkSubmission)
    .where(
      and(eq(schema.courseworkSubmission.learnerId, learnerId), eq(schema.courseworkSubmission.lessonId, lessonId))
    );
  return Number(row?.max ?? 0) + 1;
}

export interface CreateSubmissionInput {
  learnerId: string;
  courseId: string;
  lessonId: string;
  version: number;
  files: CourseworkFile[];
}

/** Insert one submission version. The UNIQUE(learner,lesson,version) constraint guards against a race. */
export async function createSubmission(input: CreateSubmissionInput): Promise<CourseworkSubmissionRow> {
  const [row] = await db.insert(schema.courseworkSubmission).values(input).returning();
  return row as CourseworkSubmissionRow;
}

/** A learner's submissions for one unit, newest version first (drives the learner's version list). */
export async function listSubmissionsForLearnerUnit(
  learnerId: string,
  lessonId: string
): Promise<CourseworkSubmissionRow[]> {
  const rows = await db
    .select()
    .from(schema.courseworkSubmission)
    .where(
      and(eq(schema.courseworkSubmission.learnerId, learnerId), eq(schema.courseworkSubmission.lessonId, lessonId))
    )
    .orderBy(desc(schema.courseworkSubmission.version));
  return rows as CourseworkSubmissionRow[];
}

/** A single submission by id (for detail + download binding). No access control here — the caller guards. */
export async function getSubmissionById(id: string): Promise<CourseworkSubmissionRow | null> {
  const [row] = await db
    .select()
    .from(schema.courseworkSubmission)
    .where(eq(schema.courseworkSubmission.id, id))
    .limit(1);
  return (row as CourseworkSubmissionRow) ?? null;
}

/**
 * The submission that owns a given file key (jsonb containment on `files`). This is the AUTHORITATIVE
 * owner lookup for the download guard: a well-formed-but-nonexistent key returns null, so a caller
 * cannot get a signed URL for an object that isn't a real coursework file. Access to the returned
 * submission is then decided by canReadCoursework — the key alone never grants anything.
 */
export async function getSubmissionByFileKey(key: string): Promise<CourseworkSubmissionRow | null> {
  const [row] = await db
    .select()
    .from(schema.courseworkSubmission)
    .where(sql`${schema.courseworkSubmission.files} @> ${JSON.stringify([{ key }])}::jsonb`)
    .limit(1);
  return (row as CourseworkSubmissionRow) ?? null;
}

export interface SubmissionWithContext extends CourseworkSubmissionRow {
  courseTitle: string;
  unitTitle: string;
  /** The recorded result on this submission version (Step 5), or null while awaiting marking. */
  result: string | null;
  /** The tutor's written feedback for this version (Step 5), or null. */
  feedback: string | null;
}

/**
 * Every submission for a set of learners, enriched with course + unit titles and the version's result
 * (left join — null until Step 5). Fed the ALREADY-ALLOCATION-SCOPED learner id set (the caseload/detail
 * services derive it from tutor_allocation), so this query never widens the roster — an empty set yields
 * an empty list. Newest submissions first.
 */
export async function getSubmissionsWithContextForLearners(learnerIds: string[]): Promise<SubmissionWithContext[]> {
  if (learnerIds.length === 0) return [];
  const rows = await db
    .select({
      id: schema.courseworkSubmission.id,
      learnerId: schema.courseworkSubmission.learnerId,
      courseId: schema.courseworkSubmission.courseId,
      lessonId: schema.courseworkSubmission.lessonId,
      version: schema.courseworkSubmission.version,
      files: schema.courseworkSubmission.files,
      status: schema.courseworkSubmission.status,
      submittedAt: schema.courseworkSubmission.submittedAt,
      courseTitle: schema.course.title,
      unitTitle: schema.lesson.title,
      result: schema.courseworkResult.result,
      feedback: schema.courseworkResult.feedback
    })
    .from(schema.courseworkSubmission)
    .leftJoin(schema.course, eq(schema.course.id, schema.courseworkSubmission.courseId))
    .leftJoin(schema.lesson, eq(schema.lesson.id, schema.courseworkSubmission.lessonId))
    .leftJoin(schema.courseworkResult, eq(schema.courseworkResult.submissionId, schema.courseworkSubmission.id))
    .where(inArray(schema.courseworkSubmission.learnerId, learnerIds))
    .orderBy(desc(schema.courseworkSubmission.submittedAt));

  return rows.map((r) => ({
    id: r.id,
    learnerId: r.learnerId,
    courseId: r.courseId,
    lessonId: r.lessonId,
    version: r.version,
    files: (r.files ?? []) as CourseworkFile[],
    status: r.status,
    submittedAt: r.submittedAt as string,
    courseTitle: r.courseTitle ?? 'Untitled course',
    unitTitle: r.unitTitle ?? 'Untitled unit',
    result: r.result ?? null,
    feedback: r.feedback ?? null
  }));
}

// ── Marking: results, the passed-helper, and the upload-closed rule (PearlLMS Phase 3 Step 5) ─────
// A result is the tutor's OFF-platform verdict recorded against ONE submission version. One result per
// version (DB unique); history is never overwritten. Access is enforced at the service/guard layer —
// these queries do no authorization of their own.

export interface CourseworkResultRow {
  id: string;
  submissionId: string;
  result: string;
  feedback: string | null;
  recordedBy: string | null;
  recordedAt: string;
}

export interface RecordResultInput {
  submissionId: string;
  result: string;
  feedback: string | null;
  recordedBy: string;
}

/** Insert the result for a submission version. UNIQUE(submission_id) makes a double-mark a 23505 race. */
export async function recordCourseworkResult(
  input: RecordResultInput,
  client: DbOrTxClient = db
): Promise<CourseworkResultRow> {
  const [row] = await client.insert(schema.courseworkResult).values(input).returning();
  return row as CourseworkResultRow;
}

/** The existing result for a submission version, or null (re-mark guard). */
export async function getResultForSubmission(submissionId: string): Promise<CourseworkResultRow | null> {
  const [row] = await db
    .select()
    .from(schema.courseworkResult)
    .where(eq(schema.courseworkResult.submissionId, submissionId))
    .limit(1);
  return (row as CourseworkResultRow) ?? null;
}

/**
 * The result value of the highest-VERSION submission that HAS a result for this learner+unit, or null
 * if none is marked. INNER JOIN drops unmarked versions, so this is exactly the "latest marked version"
 * the passed-helper follows (Step-5 semantics: a later Refer overrides an earlier Pass). Phase 4 reads this.
 */
export async function getLatestMarkedResult(
  learnerId: string,
  lessonId: string,
  client: DbOrTxClient = db
): Promise<string | null> {
  const [row] = await client
    .select({ result: schema.courseworkResult.result })
    .from(schema.courseworkSubmission)
    .innerJoin(schema.courseworkResult, eq(schema.courseworkResult.submissionId, schema.courseworkSubmission.id))
    .where(
      and(eq(schema.courseworkSubmission.learnerId, learnerId), eq(schema.courseworkSubmission.lessonId, lessonId))
    )
    .orderBy(desc(schema.courseworkSubmission.version))
    .limit(1);
  return row?.result ?? null;
}

/**
 * Canonical "has this learner passed this unit?" (PearlLMS Phase 3 Step 5; Phase 4 consumes it). True
 * iff the LATEST MARKED version's result is a passing value — a later Refer overrides an earlier Pass.
 * No marked submission → false. Reads passing-ness ONLY from config (isPassingResult).
 */
export async function hasLearnerPassedUnit(
  learnerId: string,
  lessonId: string,
  client: DbOrTxClient = db
): Promise<boolean> {
  return isPassingResult(await getLatestMarkedResult(learnerId, lessonId, client));
}

/**
 * Is upload CLOSED for this learner+unit? — true iff the highest-version submission is marked with a
 * PASSING result (a passed unit is terminal). A Refer on the latest version keeps upload open (resubmit);
 * an unmarked latest version keeps it open. This is the ONLY unit-level close — no cross-session gating.
 */
export async function isUnitUploadClosed(learnerId: string, lessonId: string): Promise<boolean> {
  const latest = await getLatestSubmissionResultState(learnerId, lessonId);
  return !!latest && isPassingResult(latest.result);
}

/**
 * The version + result of the HIGHEST-version submission overall (marked or not) for this learner+unit.
 * Backs the upload-closed rule (latest version passed ⇒ no more uploads) and the mark-latest-only check.
 */
export async function getLatestSubmissionResultState(
  learnerId: string,
  lessonId: string
): Promise<{ version: number; result: string | null } | null> {
  const [row] = await db
    .select({ version: schema.courseworkSubmission.version, result: schema.courseworkResult.result })
    .from(schema.courseworkSubmission)
    .leftJoin(schema.courseworkResult, eq(schema.courseworkResult.submissionId, schema.courseworkSubmission.id))
    .where(
      and(eq(schema.courseworkSubmission.learnerId, learnerId), eq(schema.courseworkSubmission.lessonId, lessonId))
    )
    .orderBy(desc(schema.courseworkSubmission.version))
    .limit(1);
  return row ? { version: row.version, result: row.result ?? null } : null;
}

export interface SubmissionWithResultRow extends CourseworkSubmissionRow {
  result: string | null;
  feedback: string | null;
}

/** A learner's submissions for one unit, newest version first, each with its result + feedback (own view). */
export async function listSubmissionsWithResultForLearnerUnit(
  learnerId: string,
  lessonId: string
): Promise<SubmissionWithResultRow[]> {
  const rows = await db
    .select({
      id: schema.courseworkSubmission.id,
      learnerId: schema.courseworkSubmission.learnerId,
      courseId: schema.courseworkSubmission.courseId,
      lessonId: schema.courseworkSubmission.lessonId,
      version: schema.courseworkSubmission.version,
      files: schema.courseworkSubmission.files,
      status: schema.courseworkSubmission.status,
      submittedAt: schema.courseworkSubmission.submittedAt,
      result: schema.courseworkResult.result,
      feedback: schema.courseworkResult.feedback
    })
    .from(schema.courseworkSubmission)
    .leftJoin(schema.courseworkResult, eq(schema.courseworkResult.submissionId, schema.courseworkSubmission.id))
    .where(
      and(eq(schema.courseworkSubmission.learnerId, learnerId), eq(schema.courseworkSubmission.lessonId, lessonId))
    )
    .orderBy(desc(schema.courseworkSubmission.version));

  return rows.map((r) => ({
    id: r.id,
    learnerId: r.learnerId,
    courseId: r.courseId,
    lessonId: r.lessonId,
    version: r.version,
    files: (r.files ?? []) as CourseworkFile[],
    status: r.status,
    submittedAt: r.submittedAt as string,
    result: r.result ?? null,
    feedback: r.feedback ?? null
  }));
}
