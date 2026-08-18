import { classroomio } from '$lib/utils/services/api';
import { BaseApi } from '$lib/utils/services/api/base.svelte';

export interface CurrentPosition {
  lessonId: string;
  title: string | null;
  index: number;
}

export interface CourseProgress {
  courseId: string;
  /** Non-exempt units passed. */
  passed: number;
  /** Total non-exempt units (denominator; exempt units excluded). */
  total: number;
  completed: boolean;
  completedAt: string | null;
  currentPosition: CurrentPosition | null;
}

/**
 * The current learner's OWN progress for a course (PearlLMS Phase 5 Step 3). Reads the AUTHORITATIVE server
 * computation (GET /course/:courseId/progress) — the same shared computation the Manager/Admin reports use —
 * so a learner and a Manager never see divergent numbers. Result-derived: "passed" means a tutor recorded a
 * passing result, NOT a self-marked lesson. This is the ONLY notion of progress shown to a learner; the stock
 * self-asserted indicators are hidden (docs/PROGRESS-MODEL.md §4).
 */
class CourseProgressApi extends BaseApi {
  courseId = $state<string | null>(null);
  progress = $state<CourseProgress | null>(null);

  async load(courseId: string) {
    if (!courseId) return;
    return this.execute<(typeof classroomio.course)[':courseId']['learner-progress']['$get']>({
      requestFn: () => classroomio.course[':courseId']['learner-progress'].$get({ param: { courseId } }),
      logContext: 'loading course progress',
      onSuccess: (result) => {
        this.courseId = courseId;
        this.progress = result.data as CourseProgress;
      }
    });
  }

  reset() {
    this.courseId = null;
    this.progress = null;
  }
}

export const courseProgressApi = new CourseProgressApi();
