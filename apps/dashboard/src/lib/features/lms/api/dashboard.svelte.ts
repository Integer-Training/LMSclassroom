import { BaseApiWithErrors, classroomio, type InferResponseType } from '$lib/utils/services/api';

// PearlLMS — the learner HOME summary (KPIs, progress, tutor, draft feedbacks, upcoming due dates, course
// progression, recent messages, study hours) from GET /lms/dashboard. Self-scoped server-side; the page
// reads these fields reactively.
export type GetDashboardRequest = typeof classroomio.lms.dashboard.$get;
export type GetDashboardResponse = InferResponseType<GetDashboardRequest>;
export type GetDashboardSuccess = Extract<GetDashboardResponse, { success: true }>;
export type LearnerDashboardData = GetDashboardSuccess['data'];
export type CourseProgressionRow = LearnerDashboardData['courseProgression'][number];
export type DraftFeedbackRow = LearnerDashboardData['draftFeedbacks'][number];
export type UpcomingDueRow = LearnerDashboardData['upcomingDueDates'][number];
export type RecentMessageRow = LearnerDashboardData['recentMessages'][number];

class LMSDashboardApi extends BaseApiWithErrors {
  data = $state<LearnerDashboardData | null>(null);
  loaded = $state(false);

  async load() {
    return this.execute<GetDashboardRequest>({
      requestFn: () => classroomio.lms.dashboard.$get(),
      logContext: 'fetching learner dashboard',
      onSuccess: (response) => {
        if (response.data) {
          this.data = response.data;
          this.loaded = true;
        }
      }
    });
  }
}

export const lmsDashboardApi = new LMSDashboardApi();
