import * as schema from '@db/schema';

import { and, db, desc, eq, inArray, isNotNull, isNull, sql, type DbOrTxClient } from '@db/drizzle';
import { isAssessmentKind, isPassingResult } from '@cio/utils/constants';

// Learner coursework submissions (PearlLMS Phase 3 Step 4; Phase 8 assessments). A submission is a
// learner's upload against ONE assessment item (a tagged workbook/casestudy/assignment) within a unit,
// versioned (1-based per learner+unit+assessment); history is retained (rows are never deleted). These
// are the MOST sensitive objects in the system — every read is gated by canReadCoursework at the guard
// layer; these queries do no access control of their own.
//
// Phase 8: `assessmentKey` is the lesson.documents[].key answered (null for legacy unit-level rows);
// `submissionType` is 'final' (graded PASS/REFER, gates the unit) or 'draft' (feedback-only, never gates).
// A unit is "passed" when EVERY assessment item in it has a passing latest FINAL verdict — hasLearnerPassedUnit
// aggregates this, falling back to the legacy per-unit rule for units with no tagged assessment items.

export interface CourseworkFile {
  key: string;
  name: string;
  size?: number;
  type?: string;
}

/** One assessment item of a unit (a tagged workbook/casestudy/assignment material) with its config. */
export interface AssessmentItem {
  key: string;
  kind: string;
  name: string;
  /** Optional ISO deadline (drives due-soon/overdue), or null. */
  dueAt: string | null;
  /** Whether learners may submit drafts before the final (default true; false only if explicitly set). */
  allowDrafts: boolean;
}

/**
 * The assessment items of a unit — the lesson.documents[] tagged as an assessment kind
 * (workbook/casestudy/assignment), with kind/name/dueAt/allowDrafts. Empty for a unit with only plain
 * resources (or no documents). The single source of "what must be passed" + submit-time config.
 */
export async function getAssessmentItemsForLesson(
  lessonId: string,
  client: DbOrTxClient = db
): Promise<AssessmentItem[]> {
  const [row] = await client
    .select({ documents: schema.lesson.documents })
    .from(schema.lesson)
    .where(eq(schema.lesson.id, lessonId))
    .limit(1);
  const docs = (row?.documents ?? []) as Array<{
    key: string;
    name?: string;
    kind?: string;
    dueAt?: string;
    allowDrafts?: boolean;
  }>;
  return docs
    .filter((d) => isAssessmentKind(d.kind))
    .map((d) => ({
      key: d.key,
      kind: d.kind as string,
      name: d.name ?? 'Assessment',
      dueAt: d.dueAt ?? null,
      allowDrafts: d.allowDrafts !== false
    }));
}

/** Just the keys of a unit's assessment items (see getAssessmentItemsForLesson). */
export async function getAssessmentKeysForLesson(lessonId: string, client: DbOrTxClient = db): Promise<string[]> {
  return (await getAssessmentItemsForLesson(lessonId, client)).map((i) => i.key);
}

/**
 * Assessment-item keys for MANY units at once → lessonId → keys[] (empty array for a unit with none).
 * Batched to avoid an N+1 in the provider-wide report's per-assessment pass.
 */
export async function getAssessmentKeysByLesson(
  lessonIds: string[],
  client: DbOrTxClient = db
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (lessonIds.length === 0) return map;
  const rows = await client
    .select({ id: schema.lesson.id, documents: schema.lesson.documents })
    .from(schema.lesson)
    .where(inArray(schema.lesson.id, lessonIds));
  for (const r of rows) {
    const docs = (r.documents ?? []) as Array<{ key: string; kind?: string }>;
    map.set(
      r.id,
      docs.filter((d) => isAssessmentKind(d.kind)).map((d) => d.key)
    );
  }
  return map;
}

export interface CourseworkSubmissionRow {
  id: string;
  learnerId: string;
  courseId: string;
  lessonId: string;
  assessmentKey: string | null;
  submissionType: string;
  version: number;
  files: CourseworkFile[];
  status: string;
  submittedAt: string;
}

/** The next 1-based version for this learner+unit+ASSESSMENT (max existing for that assessment + 1). */
export async function getNextSubmissionVersion(
  learnerId: string,
  lessonId: string,
  assessmentKey: string
): Promise<number> {
  const [row] = await db
    .select({ max: sql<number>`coalesce(max(${schema.courseworkSubmission.version}), 0)` })
    .from(schema.courseworkSubmission)
    .where(
      and(
        eq(schema.courseworkSubmission.learnerId, learnerId),
        eq(schema.courseworkSubmission.lessonId, lessonId),
        eq(schema.courseworkSubmission.assessmentKey, assessmentKey)
      )
    );
  return Number(row?.max ?? 0) + 1;
}

export interface CreateSubmissionInput {
  learnerId: string;
  courseId: string;
  lessonId: string;
  assessmentKey: string;
  submissionType: string;
  version: number;
  files: CourseworkFile[];
}

/** Insert one submission version. The UNIQUE(learner,lesson,assessment,version) constraint guards a race. */
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
  /** 'verdict' | 'draft' | null (unmarked) — lets the pipeline split verdicts from draft-feedback. */
  resultKind: string | null;
  /** The recorded result on this submission version (Step 5), or null while awaiting marking. */
  result: string | null;
  /** The tutor's written feedback for this version (Step 5), or null. */
  feedback: string | null;
  /** When the result was recorded, or null while unmarked (drives "recently graded" / turnaround). */
  resultRecordedAt: string | null;
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
      assessmentKey: schema.courseworkSubmission.assessmentKey,
      submissionType: schema.courseworkSubmission.submissionType,
      version: schema.courseworkSubmission.version,
      files: schema.courseworkSubmission.files,
      status: schema.courseworkSubmission.status,
      submittedAt: schema.courseworkSubmission.submittedAt,
      courseTitle: schema.course.title,
      unitTitle: schema.lesson.title,
      resultKind: schema.courseworkResult.kind,
      result: schema.courseworkResult.result,
      feedback: schema.courseworkResult.feedback,
      resultRecordedAt: schema.courseworkResult.recordedAt
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
    assessmentKey: r.assessmentKey ?? null,
    submissionType: r.submissionType,
    version: r.version,
    files: (r.files ?? []) as CourseworkFile[],
    status: r.status,
    submittedAt: r.submittedAt as string,
    courseTitle: r.courseTitle ?? 'Untitled course',
    unitTitle: r.unitTitle ?? 'Untitled unit',
    resultKind: r.resultKind ?? null,
    result: r.result ?? null,
    feedback: r.feedback ?? null,
    resultRecordedAt: (r.resultRecordedAt as string | null) ?? null
  }));
}

// ── Marking: results, the passed-helper, and the upload-closed rule (PearlLMS Phase 3 Step 5) ─────
// A result is the tutor's OFF-platform verdict recorded against ONE submission version. One result per
// version (DB unique); history is never overwritten. Access is enforced at the service/guard layer —
// these queries do no authorization of their own.

export interface CourseworkResultRow {
  id: string;
  submissionId: string;
  kind: string;
  result: string | null;
  feedback: string | null;
  recordedBy: string | null;
  recordedAt: string;
}

export interface RecordResultInput {
  submissionId: string;
  // 'verdict' (result = PASS/REFER, on a FINAL submission) | 'draft' (result null, feedback-only).
  kind: string;
  result: string | null;
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
 * LEGACY per-unit fallback (pre-Phase-8): the result of the highest-VERSION submission that has a result
 * for this learner+unit, ignoring assessment binding. Used ONLY by hasLearnerPassedUnit for units with no
 * tagged assessment items, so pre-Phase-8 courses behave EXACTLY as before. New courses go through the
 * per-assessment aggregation instead.
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
 * The verdict of the highest-VERSION FINAL submission that has a VERDICT result for one ASSESSMENT item,
 * or null if none is marked. Only FINAL submissions with a 'verdict' result count — drafts never do. This
 * is the per-assessment analogue of getLatestMarkedResult (a later Refer overrides an earlier Pass).
 */
export async function getLatestMarkedResultForAssessment(
  learnerId: string,
  lessonId: string,
  assessmentKey: string,
  client: DbOrTxClient = db
): Promise<string | null> {
  const [row] = await client
    .select({ result: schema.courseworkResult.result })
    .from(schema.courseworkSubmission)
    .innerJoin(
      schema.courseworkResult,
      and(
        eq(schema.courseworkResult.submissionId, schema.courseworkSubmission.id),
        eq(schema.courseworkResult.kind, 'verdict')
      )
    )
    .where(
      and(
        eq(schema.courseworkSubmission.learnerId, learnerId),
        eq(schema.courseworkSubmission.lessonId, lessonId),
        eq(schema.courseworkSubmission.assessmentKey, assessmentKey),
        eq(schema.courseworkSubmission.submissionType, 'final')
      )
    )
    .orderBy(desc(schema.courseworkSubmission.version))
    .limit(1);
  return row?.result ?? null;
}

/**
 * The latest FINAL verdict per assessment item for one learner+unit, as assessmentKey → result. One
 * DISTINCT-ON query (per assessment, highest version wins). Powers the unit-level pass aggregation without
 * an N+1. Only FINAL submissions with a 'verdict' result are considered.
 */
export async function getLatestMarkedResultsByAssessment(
  learnerId: string,
  lessonId: string,
  client: DbOrTxClient = db
): Promise<Map<string, string>> {
  const rows = await client
    .selectDistinctOn([schema.courseworkSubmission.assessmentKey], {
      assessmentKey: schema.courseworkSubmission.assessmentKey,
      result: schema.courseworkResult.result
    })
    .from(schema.courseworkSubmission)
    .innerJoin(
      schema.courseworkResult,
      and(
        eq(schema.courseworkResult.submissionId, schema.courseworkSubmission.id),
        eq(schema.courseworkResult.kind, 'verdict')
      )
    )
    .where(
      and(
        eq(schema.courseworkSubmission.learnerId, learnerId),
        eq(schema.courseworkSubmission.lessonId, lessonId),
        eq(schema.courseworkSubmission.submissionType, 'final'),
        isNotNull(schema.courseworkSubmission.assessmentKey)
      )
    )
    .orderBy(schema.courseworkSubmission.assessmentKey, desc(schema.courseworkSubmission.version));

  const map = new Map<string, string>();
  for (const r of rows) {
    if (r.assessmentKey && r.result != null) map.set(r.assessmentKey, r.result);
  }
  return map;
}

/** Has this learner passed ONE assessment item? — its latest FINAL verdict is a passing value. */
export async function hasLearnerPassedAssessment(
  learnerId: string,
  lessonId: string,
  assessmentKey: string,
  client: DbOrTxClient = db
): Promise<boolean> {
  return isPassingResult(await getLatestMarkedResultForAssessment(learnerId, lessonId, assessmentKey, client));
}

/**
 * Canonical "has this learner passed this UNIT?" (Phase 3 Step 5; Phase 4/5 consume it via the unchanged
 * signature). Phase 8 semantics: a unit is passed iff EVERY tagged assessment item in it has a passing
 * latest FINAL verdict. A unit with NO tagged assessment items falls back to the legacy per-unit rule, so
 * pre-Phase-8 courses are unaffected. Reads passing-ness ONLY from config (isPassingResult).
 */
export async function hasLearnerPassedUnit(
  learnerId: string,
  lessonId: string,
  client: DbOrTxClient = db
): Promise<boolean> {
  const assessmentKeys = await getAssessmentKeysForLesson(lessonId, client);
  if (assessmentKeys.length === 0) {
    return isPassingResult(await getLatestMarkedResult(learnerId, lessonId, client));
  }
  const byKey = await getLatestMarkedResultsByAssessment(learnerId, lessonId, client);
  return assessmentKeys.every((k) => isPassingResult(byKey.get(k) ?? null));
}

/**
 * Is upload CLOSED for one ASSESSMENT item? — true iff it has a passing latest FINAL verdict (a passed
 * assessment is terminal: no further drafts or finals). A Refer or an unmarked latest keeps it open.
 */
export async function isAssessmentUploadClosed(
  learnerId: string,
  lessonId: string,
  assessmentKey: string
): Promise<boolean> {
  return hasLearnerPassedAssessment(learnerId, lessonId, assessmentKey);
}

/**
 * The version + result of the HIGHEST-version submission (marked or not) for one learner+unit+ASSESSMENT.
 * Backs the mark-latest-only check (a tutor may only mark the latest version of that assessment). A null
 * assessmentKey scopes to legacy unit-level rows (IS NULL), preserving pre-Phase-8 marking of old rows.
 */
export async function getLatestSubmissionResultState(
  learnerId: string,
  lessonId: string,
  assessmentKey: string | null
): Promise<{ version: number; result: string | null } | null> {
  const [row] = await db
    .select({ version: schema.courseworkSubmission.version, result: schema.courseworkResult.result })
    .from(schema.courseworkSubmission)
    .leftJoin(schema.courseworkResult, eq(schema.courseworkResult.submissionId, schema.courseworkSubmission.id))
    .where(
      and(
        eq(schema.courseworkSubmission.learnerId, learnerId),
        eq(schema.courseworkSubmission.lessonId, lessonId),
        assessmentKey === null
          ? isNull(schema.courseworkSubmission.assessmentKey)
          : eq(schema.courseworkSubmission.assessmentKey, assessmentKey)
      )
    )
    .orderBy(desc(schema.courseworkSubmission.version))
    .limit(1);
  return row ? { version: row.version, result: row.result ?? null } : null;
}

export interface SubmissionWithResultRow extends CourseworkSubmissionRow {
  /** 'verdict' | 'draft' | null (unmarked). */
  resultKind: string | null;
  result: string | null;
  feedback: string | null;
}

/**
 * A learner's submissions for one unit, newest version first, each with its result + feedback (own view).
 * Includes assessmentKey + submissionType + resultKind so the learner UI can group per assessment item and
 * distinguish a draft-feedback from a final verdict. Optionally filtered to ONE assessment item.
 */
export async function listSubmissionsWithResultForLearnerUnit(
  learnerId: string,
  lessonId: string,
  assessmentKey?: string
): Promise<SubmissionWithResultRow[]> {
  const rows = await db
    .select({
      id: schema.courseworkSubmission.id,
      learnerId: schema.courseworkSubmission.learnerId,
      courseId: schema.courseworkSubmission.courseId,
      lessonId: schema.courseworkSubmission.lessonId,
      assessmentKey: schema.courseworkSubmission.assessmentKey,
      submissionType: schema.courseworkSubmission.submissionType,
      version: schema.courseworkSubmission.version,
      files: schema.courseworkSubmission.files,
      status: schema.courseworkSubmission.status,
      submittedAt: schema.courseworkSubmission.submittedAt,
      resultKind: schema.courseworkResult.kind,
      result: schema.courseworkResult.result,
      feedback: schema.courseworkResult.feedback
    })
    .from(schema.courseworkSubmission)
    .leftJoin(schema.courseworkResult, eq(schema.courseworkResult.submissionId, schema.courseworkSubmission.id))
    .where(
      and(
        eq(schema.courseworkSubmission.learnerId, learnerId),
        eq(schema.courseworkSubmission.lessonId, lessonId),
        ...(assessmentKey ? [eq(schema.courseworkSubmission.assessmentKey, assessmentKey)] : [])
      )
    )
    .orderBy(desc(schema.courseworkSubmission.version));

  return rows.map((r) => ({
    id: r.id,
    learnerId: r.learnerId,
    courseId: r.courseId,
    lessonId: r.lessonId,
    assessmentKey: r.assessmentKey ?? null,
    submissionType: r.submissionType,
    version: r.version,
    files: (r.files ?? []) as CourseworkFile[],
    status: r.status,
    submittedAt: r.submittedAt as string,
    resultKind: r.resultKind ?? null,
    result: r.result ?? null,
    feedback: r.feedback ?? null
  }));
}
