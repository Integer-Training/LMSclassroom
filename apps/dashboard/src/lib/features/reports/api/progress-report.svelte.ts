import { classroomio } from '$lib/utils/services/api';
import { BaseApi } from '$lib/utils/services/api/base.svelte';

export interface ReportableCourse {
  courseId: string;
  title: string | null;
}

export interface ReportRow {
  learnerId: string;
  name: string;
  passed: number;
  total: number;
  completed: boolean;
  completedAt: string | null;
  currentPosition: { lessonId: string; title: string | null; index: number } | null;
}

/**
 * Provider-wide progress + completion report (PearlLMS Phase 5 Step 4). Manager/Admin only — the API guards
 * every route with requireManagerOrAdmin. Numbers come from the SAME shared computation as the learner view;
 * the payload carries names + progress only (no profile PII).
 */
class ProgressReportApi extends BaseApi {
  courses = $state<ReportableCourse[]>([]);
  selectedCourseId = $state<string | null>(null);
  rows = $state<ReportRow[]>([]);
  loadingReport = $state(false);

  async loadCourses() {
    return this.execute<typeof classroomio.reports.progress.courses.$get>({
      requestFn: () => classroomio.reports.progress.courses.$get(),
      logContext: 'loading reportable courses',
      onSuccess: (result) => {
        this.courses = result.data as ReportableCourse[];
      }
    });
  }

  async loadReport(courseId: string) {
    if (!courseId) return;
    this.selectedCourseId = courseId;
    this.loadingReport = true;
    try {
      return await this.execute<typeof classroomio.reports.progress.$get>({
        requestFn: () => classroomio.reports.progress.$get({ query: { courseId } }),
        logContext: 'loading progress report',
        onSuccess: (result) => {
          this.rows = (result.data as { rows: ReportRow[] }).rows;
        }
      });
    } finally {
      this.loadingReport = false;
    }
  }

  reset() {
    this.courses = [];
    this.selectedCourseId = null;
    this.rows = [];
    this.loadingReport = false;
  }
}

export const progressReportApi = new ProgressReportApi();
