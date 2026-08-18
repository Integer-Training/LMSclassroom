import { classroomio } from '$lib/utils/services/api';
import { BaseApi } from '$lib/utils/services/api/base.svelte';

export interface MessageView {
  id: string;
  senderId: string;
  body: string;
  createdAt: string;
  mine: boolean;
}

export interface ThreadView {
  threadId: string;
  tutorId: string;
  learnerId: string;
  archived: boolean;
  readOnly: boolean;
  canWrite: boolean;
  counterpart: { id: string; name: string };
  messages: MessageView[];
}

/**
 * Allocation-bound tutor↔learner messaging (PearlLMS Phase 6 Step 4). Text only. All access is server-
 * enforced (participant + allocation + not-archived); this client just drives the thread UI.
 */
class MessagingApi extends BaseApi {
  view = $state<ThreadView | null>(null);
  myTutor = $state<{ tutorId: string; name: string } | null>(null);
  tutorLoaded = $state(false);
  sending = $state(false);

  async loadMyTutor() {
    return this.execute<(typeof classroomio.messages)['my-tutor']['$get']>({
      requestFn: () => classroomio.messages['my-tutor'].$get(),
      logContext: 'loading tutor',
      onSuccess: (result) => {
        this.myTutor = (result.data as { tutor: { tutorId: string; name: string } | null }).tutor;
        this.tutorLoaded = true;
      }
    });
  }

  async open(counterpartId: string) {
    return this.execute<(typeof classroomio.messages)['open']['$post']>({
      requestFn: () => classroomio.messages.open.$post({ json: { counterpartId } }),
      logContext: 'opening conversation',
      onSuccess: (result) => {
        this.view = result.data as ThreadView;
      }
    });
  }

  async loadThread(threadId: string) {
    return this.execute<(typeof classroomio.messages.threads)[':threadId']['$get']>({
      requestFn: () => classroomio.messages.threads[':threadId'].$get({ param: { threadId } }),
      logContext: 'loading conversation',
      onSuccess: (result) => {
        this.view = result.data as ThreadView;
      }
    });
  }

  async send(threadId: string, body: string) {
    const trimmed = body.trim();
    if (!trimmed) return;
    this.sending = true;
    try {
      return await this.execute<(typeof classroomio.messages.threads)[':threadId']['messages']['$post']>({
        requestFn: () =>
          classroomio.messages.threads[':threadId'].messages.$post({ param: { threadId }, json: { body: trimmed } }),
        logContext: 'sending message',
        onSuccess: (result) => {
          if (this.view) this.view.messages = [...this.view.messages, result.data as MessageView];
        }
      });
    } finally {
      this.sending = false;
    }
  }

  reset() {
    this.view = null;
    this.myTutor = null;
    this.tutorLoaded = false;
    this.sending = false;
  }
}

export const messagingApi = new MessagingApi();
