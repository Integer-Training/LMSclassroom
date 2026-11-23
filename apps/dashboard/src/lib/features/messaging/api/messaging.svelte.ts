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
  /** `email` is null for an Admin, a read-only previous tutor, or a de-allocated pairing. */
  counterpart: { id: string; name: string; email?: string | null };
  messages: MessageView[];
  /** Older messages exist before `messages[0]` — fetch them with `loadEarlier`. */
  hasMore?: boolean;
  /** The viewer is the NEW tutor reading a former tutor's thread (read-only; counterpart = the old tutor). */
  previousTutor?: boolean;
}

export interface MyTutor {
  tutorId: string;
  name: string;
  email: string | null;
}

export interface MyLearner {
  learnerId: string;
  name: string;
  email: string | null;
}

export interface PreviousThread {
  threadId: string;
  tutorName: string;
  lastAt: string | null;
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
  myTutors = $state<MyTutor[]>([]);
  /** A tutor's allocated active learners — the "New message" picker roster. */
  myLearners = $state<MyLearner[]>([]);
  myLearnersLoaded = $state(false);
  myLearnersError = $state<string | null>(null);
  /** True while startConversation is in flight (re-entry guard against double clicks). */
  starting = $state(false);
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

  /** A learner's former tutors' archived threads (read-only) — Admin, or a tutor currently allocated to them. */
  async previousThreads(learnerId: string): Promise<PreviousThread[]> {
    // Direct call (not execute()): a side list must not flip the shared isLoading, and failing is just "none".
    try {
      const res = await classroomio.messages.learners[':learnerId']['previous-threads'].$get({ param: { learnerId } });
      const result = (await res.json()) as { success: boolean; data?: PreviousThread[] };
      return result.success && Array.isArray(result.data) ? result.data : [];
    } catch (error) {
      console.error('Error loading previous conversations:', error);
      return [];
    }
  }

  async loadMyTutors() {
    this.loadError = null;
    return this.execute<(typeof classroomio.messages)['my-tutors']['$get']>({
      requestFn: () => classroomio.messages['my-tutors'].$get(),
      logContext: 'loading tutors',
      onSuccess: (result) => {
        this.myTutors = (result.data as { tutors: MyTutor[] }).tutors;
        this.tutorsLoaded = true;
      },
      onError: (error) => {
        this.loadError = errorText(error, "We couldn't load your tutors.");
      }
    });
  }

  /** The tutor's allocated active learners (empty for any other role). Drives the New-message picker. */
  async loadMyLearners() {
    this.myLearnersError = null;
    return this.execute<(typeof classroomio.messages)['my-learners']['$get']>({
      requestFn: () => classroomio.messages['my-learners'].$get(),
      logContext: 'loading learners',
      onSuccess: (result) => {
        this.myLearners = (result.data as { learners: MyLearner[] }).learners;
        this.myLearnersLoaded = true;
      },
      onError: (error) => {
        this.myLearnersError = errorText(error, "We couldn't load your learners.");
      }
    });
  }

  /**
   * Open (or reuse) the thread with an allocated learner. Resolves to the thread id, or an error text the
   * caller shows (the server's 403 wording is readable). Returns null when a start is already in flight.
   */
  async startConversation(counterpartId: string): Promise<{ threadId: string } | { error: string } | null> {
    if (this.starting) return null;
    this.starting = true;
    let failure: string | null = null;
    try {
      const res = await this.execute<(typeof classroomio.messages)['open']['$post']>({
        requestFn: () => classroomio.messages.open.$post({ json: { counterpartId } }),
        logContext: 'starting conversation',
        onError: (error) => {
          failure = errorText(error, "We couldn't start this conversation.");
        }
      });
      const threadId = (res?.data as ThreadView | undefined)?.threadId;
      if (threadId) return { threadId };
      return { error: failure ?? "We couldn't start this conversation." };
    } finally {
      this.starting = false;
    }
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
    this.myLearners = [];
    this.myLearnersLoaded = false;
    this.myLearnersError = null;
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
