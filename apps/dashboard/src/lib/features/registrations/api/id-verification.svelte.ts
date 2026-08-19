import { classroomio } from '$lib/utils/services/api';
import { BaseApi } from '$lib/utils/services/api/base.svelte';
import { snackbar } from '$features/ui/snackbar/store';

export interface IdVerificationView {
  status: string;
  statusLabel: string;
  method: string | null;
  methodLabel: string | null;
  verifiedAt: string | null;
  verifiedBy: string | null;
  note: string | null;
  updatedAt: string | null;
}

export interface MyIdVerification {
  status: string;
  verifiedAt: string | null;
}

/**
 * PearlLMS Phase 7 Step 4 — ID-verification. Staff (Manager/Admin or the allocated tutor) record/read a
 * learner's who/when/method record; a learner reads their OWN status only. NO document is ever handled here.
 */
class IdVerificationApi extends BaseApi {
  record = $state<IdVerificationView | null>(null);
  mine = $state<MyIdVerification | null>(null);
  saving = $state(false);

  async loadForLearner(learnerId: string) {
    return this.execute<(typeof classroomio.organization)['id-verification']['learner'][':learnerId']['$get']>({
      requestFn: () => classroomio.organization['id-verification'].learner[':learnerId'].$get({ param: { learnerId } }),
      logContext: 'loading id verification',
      onSuccess: (result) => {
        this.record = result.data as IdVerificationView;
      }
    });
  }

  async recordFor(learnerId: string, input: { status: string; method: string | null; note: string | null }) {
    this.saving = true;
    try {
      const res = await this.execute<
        (typeof classroomio.organization)['id-verification']['learner'][':learnerId']['$put']
      >({
        requestFn: () =>
          classroomio.organization['id-verification'].learner[':learnerId'].$put({
            param: { learnerId },
            json: { status: input.status, method: input.method ?? undefined, note: input.note ?? undefined }
          }),
        logContext: 'recording id verification',
        onSuccess: (result) => {
          this.record = result.data as IdVerificationView;
        }
      });
      if (res) snackbar.success('ID verification updated.');
      return res;
    } finally {
      this.saving = false;
    }
  }

  async loadMine() {
    return this.execute<(typeof classroomio.organization)['id-verification']['me']['$get']>({
      requestFn: () => classroomio.organization['id-verification'].me.$get(),
      logContext: 'loading my id verification',
      onSuccess: (result) => {
        this.mine = result.data as MyIdVerification;
      }
    });
  }

  reset() {
    this.record = null;
    this.mine = null;
  }
}

export const idVerificationApi = new IdVerificationApi();
