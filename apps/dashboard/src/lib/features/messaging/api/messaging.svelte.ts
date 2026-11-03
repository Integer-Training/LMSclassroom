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
  /** Older messages exist before `messages[0]` — fetch them with `loadEarlier`. */
  hasMore?: boolean;
}

export interface ConversationSummary {
  threadId: string;
  counterpart: { id: string; name: string };
  lastBody: string;
  lastAt: string;
  unread: boolean;
  archived: boolean;
}

/** Pull a human-readable message out of whatever the base API handed to onError. */
function errorText(error: unknown, fallback: string): string {
  if (typeof error === 'string') {
    try {
      return errorText(JSON.parse(error), fallback);
    } catch {
      return error || fallback;
    }
  }
  if (error && typeof error === 'object') {
    const e = error as { error?: unknown; message?: unknown };
    if (typeof e.error === 'string' && e.error) return e.error;
    if (typeof e.message === 'string' && e.message) return e.message;
  }
  return fallback;
}

/**
 * Allocation-bound tutor↔learner messaging (PearlLMS Phase 6 Step 4). Text only. All access is server-
 * enforced (participant + allocation + not-archived); this client just drives the thread UI.
 */
class MessagingApi extends BaseApi {
  view = $state<ThreadView | null>(null);
  myTutors = $state<{ tutorId: string; name: string }[]>([]);
  tutorsLoaded = $state(false);
  sending = $state(false);
  /** Why the last load (tutors / thread) failed — drives the screens' error + Retry state. */
  loadError = $state<string | null>(null);
  /** Why the last send failed — shown under the composer, which keeps the text for a retry. */
  sendError = $state<string | null>(null);
  conversations = $state<ConversationSummary[]>([]);
  conversationsLoaded = $state(false);

  async loadConversations() {
    return this.execute<(typeof classroomio.messages.threads)['$get']>({
      requestFn: () => classroomio.messages.threads.$get(),
      logContext: 'loading conversations',
      onSuccess: (result) => {
        this.conversations = result.data as ConversationSummary[];
        this.conversationsLoaded = true;
      }
    });
  }

  async loadMyTutors() {
    this.loadError = null;
    return this.execute<(typeof classroomio.messages)['my-tutors']['$get']>({
      requestFn: () => classroomio.messages['my-tutors'].$get(),
      logContext: 'loading tutors',
      onSuccess: (result) => {
        this.myTutors = (result.data as { tutors: { tutorId: string; name: string }[] }).tutors;
        this.tutorsLoaded = true;
      },
      onError: (error) => {
        this.loadError = errorText(error, "We couldn't load your tutors.");
      }
    });
  }

  async open(counterpartId: string) {
    this.loadError = null;
    this.sendError = null;
    return this.execute<(typeof classroomio.messages)['open']['$post']>({
      requestFn: () => classroomio.messages.open.$post({ json: { counterpartId } }),
      logContext: 'opening conversation',
      onSuccess: (result) => {
        this.view = result.data as ThreadView;
      },
      onError: (error) => {
        this.loadError = errorText(error, "We couldn't open this conversation.");
      }
    });
  }

  async loadThread(threadId: string) {
    this.loadError = null;
    this.sendError = null;
    return this.execute<(typeof classroomio.messages.threads)[':threadId']['$get']>({
      requestFn: () => classroomio.messages.threads[':threadId'].$get({ param: { threadId } }),
      logContext: 'loading conversation',
      onSuccess: (result) => {
        this.view = result.data as ThreadView;
      },
      onError: (error) => {
        this.loadError = errorText(error, "We couldn't load this conversation.");
      }
    });
  }

  loadingEarlier = $state(false);

  /** Prepend the page of messages just before the oldest one currently shown. */
  async loadEarlier(threadId: string) {
    const oldest = this.view?.messages[0];
    if (!this.view || !oldest || this.loadingEarlier) return;
    this.loadingEarlier = true;
    try {
      const res = await classroomio.messages.threads[':threadId'].$get({
        param: { threadId },
        query: { before: oldest.createdAt }
      });
      const result = (await res.json()) as { success: boolean; data?: ThreadView };
      if (result.success && result.data && this.view?.threadId === threadId) {
        // Older page first; drop any id already shown (a send racing the fetch can't duplicate a row).
        const shown = new Set(this.view.messages.map((m) => m.id));
        this.view.messages = [...result.data.messages.filter((m) => !shown.has(m.id)), ...this.view.messages];
        this.view.hasMore = result.data.hasMore;
      }
    } catch (error) {
      console.error('Error loading earlier messages:', error);
    } finally {
      this.loadingEarlier = false;
    }
  }

  async send(threadId: string, body: string) {
    const trimmed = body.trim();
    if (!trimmed) return;
    this.sending = true;
    this.sendError = null;
    try {
      return await this.execute<(typeof classroomio.messages.threads)[':threadId']['messages']['$post']>({
        requestFn: () =>
          classroomio.messages.threads[':threadId'].messages.$post({ param: { threadId }, json: { body: trimmed } }),
        logContext: 'sending message',
        onSuccess: (result) => {
          if (this.view) this.view.messages = [...this.view.messages, result.data as MessageView];
        },
        onError: (error) => {
          this.sendError = errorText(error, "Your message wasn't sent. Please try again.");
        }
      });
    } finally {
      this.sending = false;
    }
  }

  reset() {
    this.view = null;
    this.myTutors = [];
    this.tutorsLoaded = false;
    this.sending = false;
    this.loadError = null;
    this.sendError = null;
  }

  resetList() {
    this.conversations = [];
    this.conversationsLoaded = false;
  }
}

export const messagingApi = new MessagingApi();
