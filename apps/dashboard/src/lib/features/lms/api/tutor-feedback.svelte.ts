import { BaseApiWithErrors, classroomio, type InferResponseType } from '$lib/utils/services/api';

// PearlLMS — the every-N-units learner→tutor feedback popup. GET /lms/tutor-feedback tells us whether
// feedback is due (and the tutor it is about); POST /lms/tutor-feedback records it. Self-scoped server-side.
// The display throttle (how many times a cancelled prompt reappears) lives in the /lms layout, not here.

export type GetStatusRequest = (typeof classroomio.lms)['tutor-feedback']['$get'];
export type GetStatusResponse = InferResponseType<GetStatusRequest>;
export type GetStatusSuccess = Extract<GetStatusResponse, { success: true }>;
export type TutorFeedbackStatus = GetStatusSuccess['data'];

export interface TutorFeedbackInput {
  overallRating: number;
  communicationRating?: number;
  helpfulnessRating?: number;
  knowledgeRating?: number;
  comment?: string;
}

class TutorFeedbackApi extends BaseApiWithErrors {
  status = $state<TutorFeedbackStatus | null>(null);
  submitting = $state(false);

  async loadStatus() {
    return this.execute<GetStatusRequest>({
      requestFn: () => classroomio.lms['tutor-feedback'].$get(),
      logContext: 'loading tutor feedback status',
      onSuccess: (response) => {
        if (response.data) this.status = response.data;
      }
    });
  }

  async submit(input: TutorFeedbackInput) {
    this.submitting = true;
    try {
      const res = await this.execute<(typeof classroomio.lms)['tutor-feedback']['$post']>({
        requestFn: () => classroomio.lms['tutor-feedback'].$post({ json: input }),
        logContext: 'submitting tutor feedback'
      });
      // On success the milestone is satisfied — nothing is due any more (keep the tutor for the thank-you).
      if (res?.success && this.status) this.status = { ...this.status, dueMilestone: null };
      return res;
    } finally {
      this.submitting = false;
    }
  }
}

export const tutorFeedbackApi = new TutorFeedbackApi();
