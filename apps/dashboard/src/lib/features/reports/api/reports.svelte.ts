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

// Admin-only. Mirrors ReferralsReport in apps/api/src/services/dash/reports.ts.
export interface ReferralsReport {
  totals: {
    totalRefers: number;
    learnersReferred: number;
    learnersCurrentlyReferred: number;
    tutorsReferring: number;
  };
  perTutor: {
    tutorId: string | null;
    name: string;
    learnersReferred: number;
    totalRefers: number;
    totalGraded: number;
    referRate: number;
  }[];
  perLearner: {
    learnerId: string;
    name: string;
    timesReferred: number;
    unitsReferred: number;
    openRefers: number;
    lastReferredBy: string;
    lastReferredAt: string;
  }[];
}

// Admin-only. Mirrors TutorFeedbackReport in apps/api/src/services/dash/reports.ts.
export interface TutorFeedbackReport {
  totals: {
    totalFeedback: number;
    tutorsRated: number;
    learnersResponded: number;
    avgOverall: number;
  };
  perTutor: {
    tutorId: string | null;
    name: string;
    count: number;
    avgOverall: number;
    avgCommunication: number | null;
    avgHelpfulness: number | null;
    avgKnowledge: number | null;
  }[];
  entries: {
    id: string;
    learnerName: string;
    tutorName: string;
    milestone: number;
    overallRating: number;
    communicationRating: number | null;
    helpfulnessRating: number | null;
    knowledgeRating: number | null;
    comment: string | null;
    createdAt: string;
  }[];
}

// Admin-only. Mirrors SystemEventsReport in apps/api/src/services/dash/system-events.ts.
export interface ActivityLogRow {
  id: string;
  occurredAt: string;
  eventType: string;
  severity: string;
  userId: string | null;
  userEmail: string | null;
  ipMasked: string | null;
  path: string | null;
  method: string | null;
  httpStatus: number | null;
  message: string | null;
}

export interface ActivityLogReport {
  rows: ActivityLogRow[];
  totals: {
    total: number;
    bySeverity: Record<string, number>;
    errorsLast24h: number;
    failedLoginsLast24h: number;
  };
}

export interface ActivityLogFilters {
  from?: string;
  to?: string;
  eventType?: string;
  severity?: string;
  status?: string;
  email?: string;
  limit?: number;
}

class ReportsApi extends BaseApi {
  learners = $state<LearnersReport | null>(null);
  completions = $state<CompletionsReport | null>(null);
  referrals = $state<ReferralsReport | null>(null);
  tutorFeedback = $state<TutorFeedbackReport | null>(null);
  activityLog = $state<ActivityLogReport | null>(null);

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

  async loadReferrals() {
    return this.execute<(typeof classroomio.dash.reports.referrals)['$get']>({
      requestFn: () => classroomio.dash.reports.referrals.$get(),
      logContext: 'loading referrals report',
      onSuccess: (result) => {
        this.referrals = result.data as ReferralsReport;
      }
    });
  }

  async loadTutorFeedback() {
    return this.execute<(typeof classroomio.dash.reports)['tutor-feedback']['$get']>({
      requestFn: () => classroomio.dash.reports['tutor-feedback'].$get(),
      logContext: 'loading tutor feedback report',
      onSuccess: (result) => {
        this.tutorFeedback = result.data as TutorFeedbackReport;
      }
    });
  }

  async loadActivityLog(filters: ActivityLogFilters = {}) {
    const query: Record<string, string> = {};
    for (const [k, v] of Object.entries(filters)) {
      if (v !== undefined && v !== null && String(v).trim() !== '') query[k] = String(v);
    }
    return this.execute<(typeof classroomio.dash.reports)['activity-log']['$get']>({
      requestFn: () => classroomio.dash.reports['activity-log'].$get({ query }),
      logContext: 'loading activity log',
      onSuccess: (result) => {
        this.activityLog = result.data as unknown as ActivityLogReport;
      }
    });
  }
}

export const reportsApi = new ReportsApi();
