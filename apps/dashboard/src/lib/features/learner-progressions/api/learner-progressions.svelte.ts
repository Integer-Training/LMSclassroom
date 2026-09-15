import { classroomio } from '$lib/utils/services/api';
import { BaseApi } from '$lib/utils/services/api/base.svelte';
import { snackbar } from '$features/ui/snackbar/store';
import { courseworkApi } from '$features/course/api/coursework.svelte';

// Admin org-wide Learner Progressions (PearlLMS). The org version of the tutor caseload progression table
// (GET /organization/management/progression). The backend reuses the same progression service as the tutor
// route, so these shapes are identical to the tutor caseload client. Admin sees every learner in the org
// (server-enforced requireAdmin); this client just drives the UI.
export type ActivityStatus = 'created' | 'active' | 'inactive';

export interface KindCount {
  passed: number;
  total: number;
}
export interface ProgressionRow {
  learnerId: string;
  name: string | null;
  startDate: string | null;
  activity: ActivityStatus;
  currentPercent: number;
  currentUnitIndex: number | null;
  workbooks: KindCount;
  caseStudies: KindCount;
}
export interface ProgressionCourse {
  courseId: string;
  title: string;
}
export interface ProgressionList {
  courses: ProgressionCourse[];
  rows: ProgressionRow[];
}
export interface SubmissionDetail {
  assessmentName: string;
  kind: string;
  documentName: string;
  documentKey: string | null;
  submittedAt: string;
  markedAt: string | null;
  status: string;
}
export interface UnitDetail {
  lessonId: string;
  unitTitle: string;
  timeSeconds: number;
  submissions: SubmissionDetail[];
}
export interface CourseDetail {
  courseId: string;
  title: string;
  percent: number;
  workbooks: KindCount;
  caseStudies: KindCount;
  totalTimeSeconds: number;
  units: UnitDetail[];
}
export interface ProgressionDetail {
  learner: { id: string; name: string | null };
  courses: CourseDetail[];
}

/**
 * Admin org-wide learner progressions. The progression table + a per-learner detail cache (expandable rows).
 * All rows are org-scoped server-side (requireAdmin). File opens go through the shared guarded coursework
 * download endpoint.
 */
class LearnerProgressionsApi extends BaseApi {
  progression = $state<ProgressionList | null>(null);
  detail = $state<Record<string, ProgressionDetail>>({});
  loadingDetail = $state<Record<string, boolean>>({});
  // Monotonic id so a slow earlier course-filter response can't overwrite a newer one (stale-rows race).
  #reqId = 0;

  /** The progression table. Optional courseId narrows it to one course (server re-fetch). */
  async load(courseId?: string) {
    const reqId = ++this.#reqId;
    return this.execute<typeof classroomio.organization.management.progression.$get>({
      requestFn: () => classroomio.organization.management.progression.$get({ query: courseId ? { courseId } : {} }),
      logContext: 'loading learner progressions',
      onSuccess: (result) => {
        // Ignore a response that a newer course-filter change has already superseded.
        if (reqId === this.#reqId) this.progression = result.data as ProgressionList;
      },
      onError: (result) => {
        if (typeof result === 'string') snackbar.error(result);
      }
    });
  }

  /** One learner's progression detail (expandable row). Cached per learner; re-fetches on demand. */
  async loadDetail(learnerId: string) {
    this.loadingDetail = { ...this.loadingDetail, [learnerId]: true };
    const res = await this.execute<(typeof classroomio.organization.management.progression)[':learnerId']['$get']>({
      requestFn: () => classroomio.organization.management.progression[':learnerId'].$get({ param: { learnerId } }),
      logContext: 'loading learner progression detail',
      onSuccess: (result) => {
        this.detail = { ...this.detail, [learnerId]: result.data as ProgressionDetail };
      },
      onError: (result) => {
        if (typeof result === 'string') snackbar.error(result);
      }
    });
    this.loadingDetail = { ...this.loadingDetail, [learnerId]: false };
    return res;
  }

  /** Open one coursework file via the shared guarded download endpoint (Admin permitted server-side). */
  openFile(courseId: string, lessonId: string, key: string) {
    return courseworkApi.openFile(courseId, lessonId, key);
  }
}

export const learnerProgressionsApi = new LearnerProgressionsApi();
