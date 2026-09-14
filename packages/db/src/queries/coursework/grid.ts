import * as schema from '@db/schema';

import { alias } from 'drizzle-orm/pg-core';
import { and, db, desc, eq, inArray, type DbOrTxClient } from '@db/drizzle';
import type { CourseworkFile } from './coursework';

// PearlLMS — the tutor SUBMISSIONS GRID (Moodle-style, per workbook). Two batched reads that the grid
// service assembles into per-learner rows: (1) the roster's profile + enrolment columns, (2) every
// submission version for one assessment (with its result + grader name). No access control here — the
// caller passes an already-scoped learnerIds set (allocated∩enrolled for a tutor, all-enrolled for admin).

export interface GridLearner {
  learnerId: string;
  name: string;
  username: string;
  email: string | null;
  avatarUrl: string | null;
  status: string; // ACTIVE | DEACTIVATED
  /** groupmember.assigned_student_id — the Moodle "ID number" (nullable). */
  idNumber: string | null;
  /** groupmember.created_at — enrolment date (Moodle "Allow submissions from"). */
  enrolledAt: string | null;
}

/** The roster's profile + enrolment columns for one course, restricted to the given learner ids. */
export async function getCourseGridLearners(
  courseId: string,
  learnerIds: string[],
  client: DbOrTxClient = db
): Promise<GridLearner[]> {
  if (learnerIds.length === 0) return [];
  const rows = await client
    .select({
      learnerId: schema.profile.id,
      name: schema.profile.fullname,
      username: schema.profile.username,
      email: schema.profile.email,
      avatarUrl: schema.profile.avatarUrl,
      status: schema.profile.status,
      idNumber: schema.groupmember.assignedStudentId,
      enrolledAt: schema.groupmember.createdAt
    })
    .from(schema.profile)
    .innerJoin(
      schema.groupmember,
      and(eq(schema.groupmember.profileId, schema.profile.id), eq(schema.groupmember.roleId, 3))
    )
    .innerJoin(schema.group, eq(schema.group.id, schema.groupmember.groupId))
    .innerJoin(schema.course, eq(schema.course.groupId, schema.group.id))
    .where(and(eq(schema.course.id, courseId), inArray(schema.profile.id, learnerIds)));

  // A profile can have >1 groupmember row (e.g. multiple email entries) — keep one per learner.
  const byLearner = new Map<string, GridLearner>();
  for (const r of rows) {
    if (byLearner.has(r.learnerId)) continue;
    byLearner.set(r.learnerId, {
      learnerId: r.learnerId,
      name: r.name,
      username: r.username,
      email: r.email ?? null,
      avatarUrl: r.avatarUrl ?? null,
      status: r.status,
      idNumber: r.idNumber ?? null,
      enrolledAt: (r.enrolledAt as string | null) ?? null
    });
  }
  return [...byLearner.values()];
}

// ── Tutor read-only course outline (Phase 1) ─────────────────────────────────────────────────────────

export interface OutlineDoc {
  key: string;
  name: string;
  kind: string | null; // resource | workbook | casestudy | assignment (null = legacy resource)
  dueAt: string | null;
  allowDrafts: boolean;
  downloadable: boolean;
  link: string | null;
}
export interface OutlineUnit {
  lessonId: string;
  title: string;
  unitType: string | null;
  sectionId: string | null;
  sectionTitle: string | null;
  documents: OutlineDoc[];
}
export interface CourseOutline {
  courseId: string;
  title: string;
  units: OutlineUnit[];
}

type RawDoc = {
  key: string;
  name?: string;
  kind?: string;
  dueAt?: string;
  allowDrafts?: boolean;
  downloadable?: boolean;
  link?: string;
};

/** A course's ordered units (section-order then lesson-order), each with its documents (materials +
 *  assessments). Read model for the tutor's read-only course view. No access control here. */
export async function getCourseOutline(courseId: string, client: DbOrTxClient = db): Promise<CourseOutline | null> {
  const [courseRow] = await client
    .select({ title: schema.course.title })
    .from(schema.course)
    .where(eq(schema.course.id, courseId))
    .limit(1);
  if (!courseRow) return null;

  const rows = await client
    .select({
      lessonId: schema.lesson.id,
      title: schema.lesson.title,
      unitType: schema.lesson.unitType,
      lessonOrder: schema.lesson.order,
      sectionId: schema.courseSection.id,
      sectionTitle: schema.courseSection.title,
      sectionOrder: schema.courseSection.order,
      documents: schema.lesson.documents
    })
    .from(schema.lesson)
    .leftJoin(schema.courseSection, eq(schema.courseSection.id, schema.lesson.sectionId))
    .where(eq(schema.lesson.courseId, courseId));

  const num = (v: number | null | undefined) => (v == null ? Number.MAX_SAFE_INTEGER : Number(v));
  rows.sort(
    (a, b) =>
      num(a.sectionOrder) - num(b.sectionOrder) ||
      num(a.lessonOrder) - num(b.lessonOrder) ||
      a.lessonId.localeCompare(b.lessonId)
  );

  const units: OutlineUnit[] = rows.map((r) => ({
    lessonId: r.lessonId,
    title: r.title ?? 'Untitled unit',
    unitType: r.unitType ?? null,
    sectionId: r.sectionId ?? null,
    sectionTitle: r.sectionTitle ?? null,
    documents: ((r.documents ?? []) as RawDoc[]).map((d) => ({
      key: d.key,
      name: d.name ?? 'Untitled',
      kind: d.kind ?? null,
      dueAt: d.dueAt ?? null,
      allowDrafts: d.allowDrafts !== false,
      downloadable: d.downloadable === true,
      link: d.link ?? null
    }))
  }));

  return { courseId, title: courseRow.title ?? 'Untitled course', units };
}

/** One lesson's title (the "unit" title), or null if the lesson is gone. */
export async function getLessonTitle(lessonId: string, client: DbOrTxClient = db): Promise<string | null> {
  const [row] = await client
    .select({ title: schema.lesson.title })
    .from(schema.lesson)
    .where(eq(schema.lesson.id, lessonId))
    .limit(1);
  return row?.title ?? null;
}

export interface GridSubmission {
  submissionId: string;
  learnerId: string;
  submissionType: string; // final | draft
  version: number;
  files: CourseworkFile[];
  comment: string | null;
  status: string;
  submittedAt: string;
  resultKind: string | null; // verdict | draft | null
  result: string | null; // PASS/REFER, null while unmarked
  feedback: string | null;
  feedbackFiles: CourseworkFile[];
  recordedAt: string | null;
  recordedById: string | null;
  recordedByName: string | null;
}

/** Every submission version for ONE assessment (course,lesson,assessmentKey) across the given learners,
 *  with its result + the grader's name. Newest submission first. */
export async function getSubmissionsForAssessment(
  courseId: string,
  lessonId: string,
  assessmentKey: string,
  learnerIds: string[],
  client: DbOrTxClient = db
): Promise<GridSubmission[]> {
  if (learnerIds.length === 0) return [];
  const grader = alias(schema.profile, 'grader');
  const rows = await client
    .select({
      submissionId: schema.courseworkSubmission.id,
      learnerId: schema.courseworkSubmission.learnerId,
      submissionType: schema.courseworkSubmission.submissionType,
      version: schema.courseworkSubmission.version,
      files: schema.courseworkSubmission.files,
      comment: schema.courseworkSubmission.comment,
      status: schema.courseworkSubmission.status,
      submittedAt: schema.courseworkSubmission.submittedAt,
      resultKind: schema.courseworkResult.kind,
      result: schema.courseworkResult.result,
      feedback: schema.courseworkResult.feedback,
      feedbackFiles: schema.courseworkResult.feedbackFiles,
      recordedAt: schema.courseworkResult.recordedAt,
      recordedById: schema.courseworkResult.recordedBy,
      recordedByName: grader.fullname
    })
    .from(schema.courseworkSubmission)
    .leftJoin(schema.courseworkResult, eq(schema.courseworkResult.submissionId, schema.courseworkSubmission.id))
    .leftJoin(grader, eq(grader.id, schema.courseworkResult.recordedBy))
    .where(
      and(
        eq(schema.courseworkSubmission.courseId, courseId),
        eq(schema.courseworkSubmission.lessonId, lessonId),
        eq(schema.courseworkSubmission.assessmentKey, assessmentKey),
        inArray(schema.courseworkSubmission.learnerId, learnerIds)
      )
    )
    .orderBy(desc(schema.courseworkSubmission.submittedAt));

  return rows.map((r) => ({
    submissionId: r.submissionId,
    learnerId: r.learnerId,
    submissionType: r.submissionType,
    version: r.version,
    files: (r.files ?? []) as CourseworkFile[],
    comment: r.comment ?? null,
    status: r.status,
    submittedAt: r.submittedAt as string,
    resultKind: r.resultKind ?? null,
    result: r.result ?? null,
    feedback: r.feedback ?? null,
    feedbackFiles: (r.feedbackFiles ?? []) as CourseworkFile[],
    recordedAt: (r.recordedAt as string | null) ?? null,
    recordedById: r.recordedById ?? null,
    recordedByName: r.recordedByName ?? null
  }));
}
