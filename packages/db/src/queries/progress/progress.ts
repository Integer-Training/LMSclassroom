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

export interface OrderedUnitLite {
  lessonId: string;
  unitType: string | null;
  title: string | null;
}

/**
 * The PURE metrics core — the ONE rule/metrics implementation. Given the course's ordered units, a
 * per-unit passed predicate, and the completion date, it computes passed/total/currentPosition/completed
 * over the NON-EXEMPT units. Both the learner self-view AND the Manager/Admin report call THIS (the report
 * feeds it a batched passed-predicate, so there is no second implementation and no per-learner N+1).
 */
export function computeProgress(
  courseId: string,
  units: OrderedUnitLite[],
  isUnitPassed: (lessonId: string) => boolean,
  completedAt: string | null
): CourseProgress {
  const nonExempt = units.filter((u) => !isExemptUnitType(u.unitType));
  const total = nonExempt.length;

  let passed = 0;
  let currentPosition: CurrentPosition | null = null;
  for (let i = 0; i < nonExempt.length; i++) {
    const u = nonExempt[i];
    if (isUnitPassed(u.lessonId)) {
      passed++;
    } else if (!currentPosition) {
      currentPosition = { lessonId: u.lessonId, title: u.title, index: i + 1 };
    }
  }

  // The display `completed` boolean (total > 0 && all non-exempt passed) is the SAME rule as the trigger's
  // authority `isCourseComplete` (queries/completion) — both compose isExemptUnitType + the passed-helper.
  // Keep them in lock-step: if you change the completion rule, change it in both (docs/PROGRESS-MODEL.md §3).
  const completed = total > 0 && passed === total;
  return { courseId, passed, total, completed, completedAt, currentPosition: completed ? null : currentPosition };
}

/**
 * Compute one learner's progress in one course. Fetches the ordered units, resolves each non-exempt unit's
 * passed state (Phase-3 helper), and the completion date, then defers to the pure `computeProgress` core.
 * Reads via `client` so it can run inside a transaction.
 */
export async function computeLearnerCourseProgress(
  learnerId: string,
  courseId: string,
  client: DbOrTxClient = db
): Promise<CourseProgress> {
  const units = await getOrderedUnitsForCourse(courseId, client);
  const passed = new Set<string>();
  for (const u of units) {
    if (!isExemptUnitType(u.unitType) && (await hasLearnerPassedUnit(learnerId, u.lessonId, client))) {
      passed.add(u.lessonId);
    }
  }
  const completionRow = await getCourseCompletion(learnerId, courseId, client);
  return computeProgress(courseId, units, (lessonId) => passed.has(lessonId), completionRow?.completedAt ?? null);
}
