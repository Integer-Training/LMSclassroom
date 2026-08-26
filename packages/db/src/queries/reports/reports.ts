import * as schema from '@db/schema';

import { and, db, desc, eq, type DbOrTxClient } from '@db/drizzle';
import { isPassingResult } from '@cio/utils/constants';
import { getOrderedUnitsForCourse, type OrderedUnit } from '../gating';
import { getAssessmentKeysByLesson } from '../coursework';
import { computeProgress, type CurrentPosition } from '../progress';

// PearlLMS Phase 5 Step 4 — the provider-wide progress report (docs/PROGRESS-MODEL.md §5). One aggregate
// pass per course (NO per-learner N+1): units once, every learner's latest-marked results once, all
// completions once — then the SHARED pure `computeProgress` core runs per learner in memory, so the numbers
// are identical to the learner self-view by construction.
//
// PII RULE (§5): the report takes its identity NAME from the `user` table and NOTHING from the `profile`
// table. No profile column is ever joined or selected — so email / phone / address / DOB / any extended
// profile field cannot appear in the payload.

/** One reportable course for the filter dropdown. */
export interface ReportableCourse {
  courseId: string;
  title: string | null;
}

/** A single learner's row in the report — name + progress only, NO profile PII. */
export interface CourseProgressReportRow {
  learnerId: string;
  name: string;
  passed: number;
  total: number;
  completed: boolean;
  completedAt: string | null;
  currentPosition: CurrentPosition | null;
}

export interface CourseProgressReport {
  courseId: string;
  rows: CourseProgressReportRow[];
}

/** The org id that owns a course (via its group), or null. Used to bind the report to the actor's org. */
export async function getCourseOrgId(courseId: string, client: DbOrTxClient = db): Promise<string | null> {
  const [row] = await client
    .select({ orgId: schema.group.organizationId })
    .from(schema.course)
    .innerJoin(schema.group, eq(schema.group.id, schema.course.groupId))
    .where(eq(schema.course.id, courseId))
    .limit(1);
  return row?.orgId ?? null;
}

/** Courses in an org, for the report's course filter. Id + title only. */
export async function listReportableCourses(orgId: string, client: DbOrTxClient = db): Promise<ReportableCourse[]> {
  const rows = await client
    .select({ courseId: schema.course.id, title: schema.course.title })
    .from(schema.course)
    .innerJoin(schema.group, eq(schema.group.id, schema.course.groupId))
    .where(eq(schema.group.organizationId, orgId))
    .orderBy(schema.course.title);
  return rows.map((r) => ({ courseId: r.courseId, title: r.title ?? null }));
}

/**
 * Enrolled learners (STUDENT group members) for a course, with the display NAME from the `user` table.
 * Deliberately joins `user` (identity name) and NEVER `profile` — the report carries no profile PII (§5).
 */
export async function listEnrolledLearnersWithName(
  courseId: string,
  client: DbOrTxClient = db
): Promise<{ learnerId: string; name: string }[]> {
  const rows = await client
    .select({ learnerId: schema.groupmember.profileId, name: schema.user.name })
    .from(schema.course)
    .innerJoin(schema.group, eq(schema.group.id, schema.course.groupId))
    .innerJoin(schema.groupmember, eq(schema.groupmember.groupId, schema.group.id))
    .innerJoin(schema.user, eq(schema.user.id, schema.groupmember.profileId))
    .where(and(eq(schema.course.id, courseId), eq(schema.groupmember.roleId, 3)))
    .orderBy(schema.user.name);
  return rows
    .filter((r): r is { learnerId: string; name: string } => !!r.learnerId)
    .map((r) => ({ learnerId: r.learnerId as string, name: r.name ?? 'Learner' }));
}

/**
 * The latest FINAL verdict per (learner, lesson, ASSESSMENT) for a whole course, in ONE query (DISTINCT ON
 * the highest FINAL submission version with a 'verdict' result — Phase-8 per-assessment semantics, batched).
 * assessmentKey is null for legacy unit-level rows (which then behave as the pre-Phase-8 per-unit latest).
 * Feeds the report's per-assessment passed-predicate without a per-learner round-trip, so the report matches
 * the learner self-view (hasLearnerPassedUnit) by construction.
 */
export async function getLatestMarkedResultsForCourse(
  courseId: string,
  client: DbOrTxClient = db
): Promise<{ learnerId: string; lessonId: string; assessmentKey: string | null; result: string }[]> {
  const rows = await client
    .selectDistinctOn(
      [
        schema.courseworkSubmission.learnerId,
        schema.courseworkSubmission.lessonId,
        schema.courseworkSubmission.assessmentKey
      ],
      {
        learnerId: schema.courseworkSubmission.learnerId,
        lessonId: schema.courseworkSubmission.lessonId,
        assessmentKey: schema.courseworkSubmission.assessmentKey,
        result: schema.courseworkResult.result
      }
    )
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
        eq(schema.courseworkSubmission.courseId, courseId),
        eq(schema.courseworkSubmission.submissionType, 'final')
      )
    )
    .orderBy(
      schema.courseworkSubmission.learnerId,
      schema.courseworkSubmission.lessonId,
      schema.courseworkSubmission.assessmentKey,
      desc(schema.courseworkSubmission.version)
    );
  return rows.map((r) => ({
    learnerId: r.learnerId,
    lessonId: r.lessonId,
    assessmentKey: r.assessmentKey ?? null,
    result: r.result ?? ''
  }));
}

/** All completion records for a course → learnerId → completedAt. */
export async function getCompletionsForCourse(
  courseId: string,
  client: DbOrTxClient = db
): Promise<Map<string, string>> {
  const rows = await client
    .select({ learnerId: schema.courseCompletion.learnerId, completedAt: schema.courseCompletion.completedAt })
    .from(schema.courseCompletion)
    .where(eq(schema.courseCompletion.courseId, courseId));
  return new Map(rows.map((r) => [r.learnerId, r.completedAt]));
}

/**
 * PURE assembly: turn the batched inputs into report rows. Each row is EXACTLY {learnerId, name, passed,
 * total, completed, completedAt, currentPosition} — the allow-listed identity + progress fields, nothing
 * from `profile`. Numbers come from the shared `computeProgress` core, so they match the learner self-view
 * by construction. Separated from the fetching so it can be unit-tested without a DB.
 */
export function assembleReportRows(
  courseId: string,
  units: OrderedUnit[],
  learners: { learnerId: string; name: string }[],
  results: { learnerId: string; lessonId: string; assessmentKey: string | null; result: string }[],
  completions: Map<string, string>,
  assessmentKeysByLesson: Map<string, string[]>
): CourseProgressReportRow[] {
  // learnerId → set of passing "lessonId::assessmentKey" (assessmentKey '' for legacy unit-level rows).
  const keyOf = (lessonId: string, assessmentKey: string | null) => `${lessonId}::${assessmentKey ?? ''}`;
  const passedByLearner = new Map<string, Set<string>>();
  for (const r of results) {
    if (!isPassingResult(r.result)) continue;
    let set = passedByLearner.get(r.learnerId);
    if (!set) {
      set = new Set<string>();
      passedByLearner.set(r.learnerId, set);
    }
    set.add(keyOf(r.lessonId, r.assessmentKey));
  }

  return learners.map(({ learnerId, name }) => {
    const passed = passedByLearner.get(learnerId) ?? new Set<string>();
    // A unit with tagged assessments is passed iff EVERY item is passed (matches hasLearnerPassedUnit); a
    // unit with none falls back to the legacy per-unit passing result (null assessmentKey).
    const isUnitPassed = (lessonId: string): boolean => {
      const keys = assessmentKeysByLesson.get(lessonId) ?? [];
      return keys.length > 0
        ? keys.every((k) => passed.has(keyOf(lessonId, k)))
        : passed.has(keyOf(lessonId, null));
    };
    const p = computeProgress(courseId, units, isUnitPassed, completions.get(learnerId) ?? null);
    return {
      learnerId,
      name,
      passed: p.passed,
      total: p.total,
      completed: p.completed,
      completedAt: p.completedAt,
      currentPosition: p.currentPosition
    };
  });
}

/**
 * The full per-course report: one row per enrolled learner with name + passed/total + current position +
 * completion. One aggregate pass — units + all learners' latest results + all completions in parallel, then
 * the shared pure assembly. No profile table anywhere in the pipeline.
 */
export async function getCourseProgressReport(
  courseId: string,
  client: DbOrTxClient = db
): Promise<CourseProgressReport> {
  const [units, learners, results, completions] = await Promise.all([
    getOrderedUnitsForCourse(courseId, client),
    listEnrolledLearnersWithName(courseId, client),
    getLatestMarkedResultsForCourse(courseId, client),
    getCompletionsForCourse(courseId, client)
  ]);
  const assessmentKeysByLesson = await getAssessmentKeysByLesson(
    units.map((u) => u.lessonId),
    client
  );
  return { courseId, rows: assembleReportRows(courseId, units, learners, results, completions, assessmentKeysByLesson) };
}
