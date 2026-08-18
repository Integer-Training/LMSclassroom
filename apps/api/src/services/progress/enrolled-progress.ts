import { computeLearnerCourseProgress } from '@cio/db/queries/progress';

// PearlLMS Phase 5 — reconcile the LMS-home progress surfaces (docs/PROGRESS-MODEL.md §4). The stock
// enrolled-courses payload carries self-marked progress (progressRate = completed lessons). For the learner's
// own apprenticeship courses we OVERRIDE those numeric fields with the RESULT-DERIVED metrics (passed/total
// over non-exempt units), so every home surface that reads course.progressRate / lessonCount (the course
// card bar, the My-Learning In-Progress/Complete buckets, the dashboard KPIs) shows the SAME single notion of
// progress as the course view and the Manager report — no per-surface rewiring, one source of truth.
//
// Compliance courses are left untouched (their completion is complianceStatus, a separate stock feature).
// A course with no non-exempt units (total 0) keeps its stock numbers. The overlay is best-effort per course:
// a failure leaves that course's stock values rather than breaking the whole home load.

interface OverlayableCourse {
  id: string;
  type?: string | null;
  progressRate?: number;
  lessonCount?: number;
  exerciseCount?: number;
  exercisesCompleted?: number;
}

/**
 * Mutate `courses` in place, replacing each non-compliance course's stock progress counters with the
 * learner's result-derived passed/total. After this, getStudentCourseProgressPercent / isStudentCourseComplete
 * (which read these fields) yield the result-derived progress + completion everywhere on the LMS home.
 */
export async function overlayResultDerivedProgress<T extends OverlayableCourse>(
  learnerId: string,
  courses: T[]
): Promise<void> {
  await Promise.all(
    courses.map(async (course) => {
      if (course.type === 'COMPLIANCE') return;
      try {
        const p = await computeLearnerCourseProgress(learnerId, course.id);
        if (p.total > 0) {
          // completed items / total items = passed / total  (exercises zeroed so the ratio is exact).
          course.progressRate = p.passed;
          course.lessonCount = p.total;
          course.exercisesCompleted = 0;
          course.exerciseCount = 0;
        }
      } catch (error) {
        console.error(`[home-progress] result-derived overlay failed for course ${course.id} (stock kept):`, error);
      }
    })
  );
}
