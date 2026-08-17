import * as schema from '@db/schema';

import { and, db, desc, eq, sql } from '@db/drizzle';

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
