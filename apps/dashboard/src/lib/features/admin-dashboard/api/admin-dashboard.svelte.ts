import { classroomio } from '$lib/utils/services/api';
import { BaseApi } from '$lib/utils/services/api/base.svelte';

// Admin analytics dashboard (PearlLMS). Platform-wide overview + live "online now" panel. The API is
// org-scoped server-side; the client just passes the current org id. Shapes mirror the typed RPC route.

export interface AdminHeadline {
  totalLearners: number;
  activeLearners: number;
  inactiveLearners: number;
  suspendedLearners: number;
  neverLoggedIn: number;
  learnersWithPendingWork: number;
  totalTutors: number;
  avgLearnersPerTutor: number;
  totalManagers: number;
  totalAdmins: number;
  activeCourses: number;
  awaitingMarking: number;
  overdue: number;
  dueSoon: number;
  awaitingDraftFeedback: number;
  resubmissions: number;
  totalGraded: number;
  passCount: number;
  referCount: number;
  passRate: number | null;
  avgTurnaroundDays: number | null;
  pendingRegistrations: number;
  unverifiedLearners: number;
  activeBroadcasts: number;
  openThreads: number;
  messagesLast7d: number;
  completionsThisMonth: number;
  certificatesEarned: number;
  activeLearners7d: number;
  activeLearners30d: number;
}

export interface AdminCharts {
  learnerStatus: { active: number; inactive: number; suspended: number; neverLoggedIn: number };
  enrollmentTrend: { month: number; count: number }[];
  submissionsTrend: { month: number; count: number }[];
  studyHoursMonthly: { month: number; hours: number }[];
  outcomes: { passCount: number; referCount: number; passRate: number | null };
  registrationFunnel: { pending: number; approved: number; rejected: number };
  idVerification: { verified: number; failed: number; notVerified: number };
}

export interface AdminTutorRow {
  tutorId: string;
  name: string | null;
  email: string | null;
  learners: number;
  awaitingMarking: number;
  inactiveLearners: number;
  avgTurnaroundDays: number | null;
  passRate: number | null;
}

export interface AdminCourseRow {
  courseId: string;
  title: string;
  isPublished: boolean;
  enrolled: number;
  active30d: number;
  assessments: number;
  completionPercent: number;
}

export interface AdminOverview {
  generatedAt: string;
  headline: AdminHeadline;
  charts: AdminCharts;
  tutors: AdminTutorRow[];
  courses: AdminCourseRow[];
}

export interface OnlineNowUser {
  userId: string;
  name: string | null;
  email: string | null;
  role: string;
  lastActive: string;
}

export interface OnlineNow {
  count: number;
  byRole: { learners: number; tutors: number; managers: number; admins: number };
  users: OnlineNowUser[];
}

class AdminDashboardApi extends BaseApi {
  overview = $state<AdminOverview | null>(null);
  online = $state<OnlineNow | null>(null);
  loading = $state(false);
  onlineLoading = $state(false);

  async loadOverview(orgId: string) {
    this.loading = true;
    try {
      return await this.execute<(typeof classroomio.dash)['admin-overview']['$get']>({
        requestFn: () => classroomio.dash['admin-overview'].$get({ query: { orgId } }),
        logContext: 'loading admin overview',
        onSuccess: (result) => {
          this.overview = result.data as AdminOverview;
        }
      });
    } finally {
      this.loading = false;
    }
  }

  async loadOnline(orgId: string) {
    this.onlineLoading = true;
    try {
      return await this.execute<(typeof classroomio.dash)['online-now']['$get']>({
        requestFn: () => classroomio.dash['online-now'].$get({ query: { orgId } }),
        logContext: 'loading online-now',
        onSuccess: (result) => {
          this.online = result.data as OnlineNow;
        }
      });
    } finally {
      this.onlineLoading = false;
    }
  }

  reset() {
    this.overview = null;
    this.online = null;
    this.loading = false;
    this.onlineLoading = false;
  }
}

export const adminDashboardApi = new AdminDashboardApi();
