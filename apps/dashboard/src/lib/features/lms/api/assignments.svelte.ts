import { BaseApiWithErrors, classroomio, type InferResponseType } from '$lib/utils/services/api';

// PearlLMS — the learner's own assessments (workbooks / case studies / assignments) across every enrolled
// course, from GET /lms/assignments. Self-scoped server-side; this client just drives the board.
export type GetAssignmentsRequest = typeof classroomio.lms.assignments.$get;
export type GetAssignmentsResponse = InferResponseType<GetAssignmentsRequest>;
export type GetAssignmentsSuccess = Extract<GetAssignmentsResponse, { success: true }>;
export type LearnerAssignmentsData = GetAssignmentsSuccess['data'];
export type LearnerAssignment = LearnerAssignmentsData['items'][number];
export type AssignmentState = LearnerAssignment['state'];

class LMSAssignmentsApi extends BaseApiWithErrors {
  data = $state<LearnerAssignmentsData | null>(null);
  loaded = $state(false);

  /** Load the caller's assessments across all their enrolled courses. */
  async load() {
    return this.execute<GetAssignmentsRequest>({
      requestFn: () => classroomio.lms.assignments.$get(),
      logContext: 'fetching assignments',
      onSuccess: (response) => {
        if (response.data) {
          this.data = response.data;
          this.loaded = true;
        }
      }
    });
  }
}

export const lmsAssignmentsApi = new LMSAssignmentsApi();
