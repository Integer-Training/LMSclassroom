import { db, type DbOrTxClient } from '@db/drizzle';
import { isExemptUnitType } from '@cio/utils/constants';
import { getOrderedUnitsForCourse } from '../gating';
import { hasLearnerPassedUnit } from '../coursework';
import { getCourseCompletion } from '../completion';

// PearlLMS Phase 5 Step 3 — the ONE shared progress computation (docs/PROGRESS-MODEL.md §3). Both the
// learner self-view (Step 3) and the Manager/Admin reports (Step 4) call THIS — one implementation, two
// presentations, so a learner and a Manager never see divergent numbers. Metrics are over the course's
// NON-EXEMPT units only (induction / id-check excluded from both numerator and denominator). Computed live
// from the Phase-3 passed-helper; the completion DATE comes from the durable course_completion row.

export interface CurrentPosition {
  /** The learner's current (lowest-order not-yet-passed) non-exempt unit. */
  lessonId: string;
  title: string | null;
  /** 1-based position among the non-exempt units — the "N" in "on Session N of {total}". */
  index: number;
}

export interface CourseProgress {
  courseId: string;
  /** Non-exempt units with a passing latest marked result. */
  passed: number;
  /** Total non-exempt units — the denominator (exempt units excluded). */
  total: number;
  /** True iff total > 0 and every non-exempt unit is passed (the live rule). */
  completed: boolean;
  /** The durable completion date, or null if not recorded yet. */
  completedAt: string | null;
  /** The current session pointer, or null when completed (or no non-exempt units exist). */
  currentPosition: CurrentPosition | null;
}

/**
 * Compute one learner's progress in one course. passed = non-exempt units passed; total = non-exempt count;
 * currentPosition = the first non-exempt unit not yet passed (1-based index among non-exempt units), null
 * when complete; completedAt from the course_completion row. Reads via `client` so a report can batch it.
 */
export async function computeLearnerCourseProgress(
  learnerId: string,
  courseId: string,
  client: DbOrTxClient = db
): Promise<CourseProgress> {
  const units = await getOrderedUnitsForCourse(courseId, client);
  const nonExempt = units.filter((u) => !isExemptUnitType(u.unitType));
  const total = nonExempt.length;

  let passed = 0;
  let currentPosition: CurrentPosition | null = null;
  for (let i = 0; i < nonExempt.length; i++) {
    const u = nonExempt[i];
    if (await hasLearnerPassedUnit(learnerId, u.lessonId, client)) {
      passed++;
    } else if (!currentPosition) {
      currentPosition = { lessonId: u.lessonId, title: u.title, index: i + 1 };
    }
  }

  const completed = total > 0 && passed === total;
  if (completed) currentPosition = null;

  const completionRow = await getCourseCompletion(learnerId, courseId, client);

  return {
    courseId,
    passed,
    total,
    completed,
    completedAt: completionRow?.completedAt ?? null,
    currentPosition
  };
}
