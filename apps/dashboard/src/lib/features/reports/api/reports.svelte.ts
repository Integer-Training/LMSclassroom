import { classroomio } from '$lib/utils/services/api';
import { BaseApi } from '$lib/utils/services/api/base.svelte';

// PearlLMS admin REPORTS clients. Learners + Completions have their own endpoints; Marking + Courses render
// off the existing admin-overview bundle (adminDashboardApi). Admin/Manager only (API enforced).

export interface LearnersReport {
  total: number;
  activity: { created: number; active: number; inactive: number };
  avgProgress: number;
  distribution: { bucket: string; count: number }[];
  workbooks: { passed: number; total: number };
  caseStudies: { passed: number; total: number };
  newThisMonth: number;
  atRisk: { learnerId: string; name: string | null; percent: number; startDate: string | null }[];
}

export interface CompletionsReport {
  totalCompletions: number;
  completionsThisMonth: number;
  certificates: { total: number; thisMonth: number };
  avgTimeToCompleteDays: number | null;
  completionsTrend: { month: number; count: number }[];
  byCourse: {
    courseId: string;
    title: string;
    enrolled: number;
    completed: number;
    rate: number;
    avgDays: number | null;
  }[];
}

class ReportsApi extends BaseApi {
  learners = $state<LearnersReport | null>(null);
  completions = $state<CompletionsReport | null>(null);

  async loadLearners() {
    return this.execute<(typeof classroomio.dash.reports.learners)['$get']>({
      requestFn: () => classroomio.dash.reports.learners.$get(),
      logContext: 'loading learners report',
      onSuccess: (result) => {
        this.learners = result.data as LearnersReport;
      }
    });
  }

  async loadCompletions() {
    return this.execute<(typeof classroomio.dash.reports.completions)['$get']>({
      requestFn: () => classroomio.dash.reports.completions.$get(),
      logContext: 'loading completions report',
      onSuccess: (result) => {
        this.completions = result.data as CompletionsReport;
      }
    });
  }
}

export const reportsApi = new ReportsApi();
