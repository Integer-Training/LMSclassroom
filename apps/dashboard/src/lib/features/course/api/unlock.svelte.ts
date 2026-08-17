import { classroomio } from '$lib/utils/services/api';
import { BaseApi } from '$lib/utils/services/api/base.svelte';

export interface UnitLockState {
  unlocked: boolean;
  lockedByTitle: string | null;
}

/**
 * Per-unit sequential-unlock state for the current course (PearlLMS Phase 4 Step 3). The map is the
 * AUTHORITATIVE server computation (GET /course/:courseId/unlock) — the outline + lesson page read it to
 * PRESENT locked state; they never recompute the chain. Staff / toggle-off courses come back all-unlocked.
 * The server content/material/upload guards remain the actual control.
 */
class CourseUnlockApi extends BaseApi {
  courseId = $state<string | null>(null);
  map = $state<Record<string, UnitLockState>>({});

  async load(courseId: string) {
    if (!courseId) return;
    return this.execute<(typeof classroomio.course)[':courseId']['unlock']['$get']>({
      requestFn: () => classroomio.course[':courseId'].unlock.$get({ param: { courseId } }),
      logContext: 'loading unlock state',
      onSuccess: (result) => {
        this.courseId = courseId;
        this.map = result.data as Record<string, UnitLockState>;
      }
    });
  }

  /** Is this unit locked for the current learner? (Absent / unlocked → false.) */
  isLocked(lessonId: string | undefined): boolean {
    return !!lessonId && this.map[lessonId]?.unlocked === false;
  }

  /** The title of the session that unlocks this unit, or null. */
  hint(lessonId: string | undefined): string | null {
    return (lessonId && this.map[lessonId]?.lockedByTitle) || null;
  }

  reset() {
    this.courseId = null;
    this.map = {};
  }
}

export const courseUnlockApi = new CourseUnlockApi();
