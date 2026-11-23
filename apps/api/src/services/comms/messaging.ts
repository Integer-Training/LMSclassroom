import { AppError, ErrorCodes } from '@api/utils/errors';
import type { Actor } from '@cio/db/actor';
import { MESSAGE_MAX_LENGTH } from '@cio/utils/constants';
import { isTutorAllocatedToLearner, listLearnersForTutor, listTutorsForLearner } from '@cio/db/queries/allocation';
import { getProfileStatusForIds } from '@cio/db/queries/caseload';
import { getProfileById } from '@cio/db/queries/auth';
import { getOrganizationById } from '@cio/db/queries/organization';
import {
  ensureActiveThread,
  getProfileNamesByIds,
  getThreadById,
  insertMessage,
  listConversationsForParticipant,
  listPreviousTutorThreads,
  listMessagesPage,
  markNotificationsReadForEntity,
  markThreadRead as markThreadReadQuery,
  type MessageThreadRow
} from '@cio/db/queries/comms';
import { emitNotification } from '@api/services/comms/notify';
import { buildEmailBranding } from '@cio/email';
import { getAppBaseUrl } from '@cio/core/config/dashboard-url';

// PearlLMS Phase 6 Step 4 — allocation-bound tutor↔learner messaging (docs/COMMS-MODEL.md §4, D2, D4).
// TEXT ONLY. Access is enforced HERE, on every read/write:
//   - READ a thread: a participant (tutor_id or learner_id) OR an ADMIN (D2 — silent oversight, no write).
//   - WRITE (send): a participant of an ACTIVE (not archived) thread whose pair is CURRENTLY allocated
//     (live isTutorAllocatedToLearner). Admin/Manager are never participants, so they cannot write.
//   - OPEN a thread: an allocated participant only (tutor with their learner, or learner with their tutor).
// A message.received notification (in-app always + a coalesced content-light email) fires to the OTHER
// participant through the ONE Step-2 pipeline. Reallocation archives the old thread (read-only) elsewhere.

function assertAuthed(actor: Actor): asserts actor is Extract<Actor, { authenticated: true }> {
  if (!actor.authenticated) throw new AppError('Unauthorized', ErrorCodes.UNAUTHORIZED, 401);
}

function isParticipant(actor: Extract<Actor, { authenticated: true }>, thread: MessageThreadRow): boolean {
  return actor.userId === thread.tutorId || actor.userId === thread.learnerId;
}

/**
 * THE read rule for a thread (D4, revised). Admin always (D2). The learner participant always. The thread's own
 * tutor only while STILL allocated to the learner (a removed tutor loses access, archived thread included). A
 * DIFFERENT tutor only when currently allocated to the learner AND the thread is archived AND its tutor is no
 * longer allocated — i.e. a predecessor's thread; a live co-tutor's conversation stays private.
 */
async function canReadThread(
  actor: Extract<Actor, { authenticated: true }>,
  thread: MessageThreadRow
): Promise<boolean> {
  if (actor.role === 'ADMIN') return true;
  if (actor.userId === thread.learnerId) return true;
  if (actor.userId === thread.tutorId) return isTutorAllocatedToLearner(thread.tutorId, thread.learnerId);
  if (actor.role !== 'TUTOR' || thread.archivedAt == null) return false;
  if (!(await isTutorAllocatedToLearner(actor.userId, thread.learnerId))) return false;
  return !(await isTutorAllocatedToLearner(thread.tutorId, thread.learnerId));
}

/** Advance the read cursor AND clear the bell's "New message" rows for the thread (best-effort). */
async function markThreadAndNotificationsRead(threadId: string, userId: string): Promise<void> {
  await markThreadReadQuery(threadId, userId);
  try {
    await markNotificationsReadForEntity(userId, 'message_thread', threadId);
  } catch (error) {
    console.error('[messaging] clearing thread notifications failed (thread still marked read):', error);
  }
}

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
  /** The viewer is a (current) tutor reading a PREDECESSOR's archived thread — read-only. */
  previousTutor: boolean;
  /**
   * `email` is the contact address for the Email button: non-null ONLY for a participant whose pair is currently
   * allocated and who is not reading a previous tutor's thread; null for Admin oversight and de-allocated views.
   */
  counterpart: { id: string; name: string; email: string | null };
  /** Oldest-first window: the newest page, or (with a `before` cursor) the page just before it. */
  messages: MessageView[];
  /** Older messages exist beyond this window — page back with `before = messages[0].createdAt`. */
  hasMore: boolean;
}

async function buildView(
  actor: Extract<Actor, { authenticated: true }>,
  thread: MessageThreadRow,
  page: { limit?: number; before?: string } = {}
): Promise<ThreadView> {
  const participant = isParticipant(actor, thread);
  // For a participant, the counterpart is the OTHER party; for an Admin overseer, show the learner as subject.
  const counterpartId = actor.userId === thread.tutorId ? thread.learnerId : thread.tutorId;
  const [counterpart, [counterpartName], { messages, hasMore }, allocated] = await Promise.all([
    getProfileById(counterpartId),
    getProfileNamesByIds([counterpartId]), // real name (user.name first), same source as notifications
    listMessagesPage(thread.id, page),
    isTutorAllocatedToLearner(thread.tutorId, thread.learnerId)
  ]);
  const archived = thread.archivedAt != null;
  const previousTutor = actor.role === 'TUTOR' && actor.userId !== thread.tutorId;
  const email = participant && allocated && !previousTutor ? (counterpart?.email ?? null) : null;

  return {
    threadId: thread.id,
    tutorId: thread.tutorId,
    learnerId: thread.learnerId,
    archived,
    // A participant of an archived pair sees the conversation read-only; an Admin overseer is always read-only.
    readOnly: !participant || archived || !allocated,
    canWrite: participant && !archived && allocated,
    previousTutor,
    counterpart: { id: counterpartId, name: counterpartName?.name ?? counterpart?.fullname ?? 'Conversation', email },
    hasMore,
    messages: messages.map((m) => ({
      id: m.id,
      senderId: m.senderId,
      body: m.body,
      createdAt: m.createdAt,
      mine: m.senderId === actor.userId
    }))
  };
}

export interface ConversationSummary {
  threadId: string;
  counterpart: { id: string; name: string };
  lastBody: string;
  lastAt: string;
  unread: boolean;
  archived: boolean;
}

/**
 * The actor's conversations (inbox), newest-active first: a TUTOR sees a row per learner who has messaged (or
 * been messaged); a LEARNER sees a row per tutor. Self-scoped — only threads the actor participates in.
 */
export async function listConversations(actor: Actor): Promise<ConversationSummary[]> {
  assertAuthed(actor);
  const all = await listConversationsForParticipant(actor.userId);
  // A tutor's inbox only lists learners still allocated to them (a removed learner's thread is no longer theirs).
  const rows =
    actor.role === 'TUTOR'
      ? (
          await Promise.all(
            all.map(async (r) => ((await isTutorAllocatedToLearner(actor.userId, r.counterpartId)) ? r : null))
          )
        ).filter((r): r is NonNullable<typeof r> => r !== null)
      : all;
  return rows.map((r) => ({
    threadId: r.threadId,
    counterpart: { id: r.counterpartId, name: r.counterpartName },
    lastBody: r.body,
    lastAt: r.createdAt,
    unread: r.unread,
    archived: r.archived
  }));
}

/**
 * Every tutor allocated to the learner (so a learner with several can choose whom to message), ordered by
 * name then id so the list — and the default pick — is stable between visits. `email` is the allocated
 * tutor's contact address (allocation-guarded: only the learner's own tutors are ever listed). Empty → empty state.
 */
export async function getMyTutors(actor: Actor): Promise<{ tutorId: string; name: string; email: string | null }[]> {
  assertAuthed(actor);
  const tutors = await listTutorsForLearner(actor.userId);
  const names = new Map((await getProfileNamesByIds(tutors.map((t) => t.tutorId))).map((p) => [p.id, p.name]));
  const named = tutors.map((t) => ({
    tutorId: t.tutorId,
    name: names.get(t.tutorId) ?? 'Your tutor',
    email: t.email ?? null
  }));
  return named.sort((a, b) => a.name.localeCompare(b.name) || a.tutorId.localeCompare(b.tutorId));
}

/**
 * The learners a TUTOR can start a conversation with: their own allocated learners, minus deactivated
 * accounts (picker only — existing threads are unaffected), sorted by name (case-insensitive). Any other
 * role gets an empty list. `email` is the allocated learner's contact address.
 */
export async function getMyLearners(
  actor: Actor
): Promise<{ learnerId: string; name: string; email: string | null }[]> {
  assertAuthed(actor);
  if (actor.role !== 'TUTOR') return [];
  const learners = await listLearnersForTutor(actor.userId);
  const status = await getProfileStatusForIds(learners.map((l) => l.learnerId));
  return learners
    .filter((l) => (status.get(l.learnerId) ?? 'ACTIVE') !== 'DEACTIVATED')
    .map((l) => ({ learnerId: l.learnerId, name: l.name ?? 'Learner', email: l.email ?? null }))
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.learnerId.localeCompare(b.learnerId));
}

/** The learner's default allocated tutor (first of {@link getMyTutors}), or null → empty state. */
export async function getMyTutor(actor: Actor): Promise<{ tutorId: string; name: string } | null> {
  return (await getMyTutors(actor))[0] ?? null;
}

/** Open/ensure the thread for an allocated pair (reactivates an archived same-pair thread). Returns the view. */
export async function openThread(actor: Actor, counterpartId: string): Promise<ThreadView> {
  assertAuthed(actor);
  let tutorId: string;
  let learnerId: string;
  if (actor.role === 'TUTOR') {
    tutorId = actor.userId;
    learnerId = counterpartId;
  } else if (actor.role === 'LEARNER') {
    learnerId = actor.userId;
    tutorId = counterpartId;
  } else {
    // Admin/Manager are not participants — they cannot start a conversation.
    throw new AppError('Only a tutor or learner can open a message thread', ErrorCodes.FORBIDDEN, 403);
  }

  if (!(await isTutorAllocatedToLearner(tutorId, learnerId))) {
    throw new AppError(
      actor.role === 'TUTOR'
        ? "This learner is no longer allocated to you, so you can't message them."
        : 'This tutor is no longer allocated to you.',
      ErrorCodes.FORBIDDEN,
      403
    );
  }

  const thread = await ensureActiveThread(actor.orgId, tutorId, learnerId);
  await markThreadAndNotificationsRead(thread.id, actor.userId);
  return buildView(actor, thread);
}

/**
 * View a thread by id — participant OR Admin (D2). A participant's read cursor is advanced on view (not when
 * paging back with `before`: older history is already read). Returns the newest messages, oldest-first.
 */
export async function getThreadView(
  actor: Actor,
  threadId: string,
  page: { limit?: number; before?: string } = {}
): Promise<ThreadView> {
  assertAuthed(actor);
  const thread = await getThreadById(threadId);
  if (!thread) throw new AppError('Thread not found', ErrorCodes.NOT_FOUND, 404);

  const participant = isParticipant(actor, thread);
  if (!(await canReadThread(actor, thread))) {
    throw new AppError('You do not have access to this conversation', ErrorCodes.FORBIDDEN, 403);
  }
  if (participant && !page.before) await markThreadAndNotificationsRead(thread.id, actor.userId);
  return buildView(actor, thread, page);
}

/** Mark a thread read for the actor (participant only). */
export async function markThreadRead(actor: Actor, threadId: string): Promise<void> {
  assertAuthed(actor);
  const thread = await getThreadById(threadId);
  if (!thread || !isParticipant(actor, thread) || !(await canReadThread(actor, thread))) {
    throw new AppError('You do not have access to this conversation', ErrorCodes.FORBIDDEN, 403);
  }
  await markThreadAndNotificationsRead(threadId, actor.userId);
}

/**
 * A learner's previous tutors' archived threads (read-only for the new tutor). Admin, or a tutor CURRENTLY
 * allocated to the learner; anyone else → 403.
 */
export async function getPreviousTutorThreads(
  actor: Actor,
  learnerId: string
): Promise<{ threadId: string; tutorName: string; lastAt: string }[]> {
  assertAuthed(actor);
  const allowed =
    actor.role === 'ADMIN' || (actor.role === 'TUTOR' && (await isTutorAllocatedToLearner(actor.userId, learnerId)));
  if (!allowed) throw new AppError('You do not have access to this learner', ErrorCodes.FORBIDDEN, 403);
  const rows = await listPreviousTutorThreads(learnerId);
  return rows.map((r) => ({ threadId: r.threadId, tutorName: r.tutorName, lastAt: r.lastMessageAt }));
}

/** Send a text message. Participant of an active, still-allocated pair only. Emits message.received. */
export async function sendMessage(actor: Actor, threadId: string, rawBody: string): Promise<MessageView> {
  assertAuthed(actor);
  const body = rawBody.trim();
  if (!body) throw new AppError('A message cannot be empty', ErrorCodes.VALIDATION_ERROR, 400, 'body');
  if (body.length > MESSAGE_MAX_LENGTH) {
    throw new AppError(
      `A message cannot exceed ${MESSAGE_MAX_LENGTH} characters`,
      ErrorCodes.VALIDATION_ERROR,
      400,
      'body'
    );
  }

  const thread = await getThreadById(threadId);
  if (!thread) throw new AppError('Thread not found', ErrorCodes.NOT_FOUND, 404);
  if (!isParticipant(actor, thread)) {
    throw new AppError('You do not have access to this conversation', ErrorCodes.FORBIDDEN, 403);
  }
  if (thread.archivedAt != null) {
    throw new AppError('This conversation is read-only', ErrorCodes.FORBIDDEN, 403);
  }
  if (!(await isTutorAllocatedToLearner(thread.tutorId, thread.learnerId))) {
    throw new AppError('This conversation is no longer active', ErrorCodes.FORBIDDEN, 403);
  }

  const row = await insertMessage(threadId, actor.userId, body);
  // The sender has, by definition, read up to their own message.
  await markThreadReadQuery(threadId, actor.userId).catch(() => {});

  // Notify the OTHER participant — in-app always + a coalesced content-light email (never the body).
  const recipientId = actor.userId === thread.tutorId ? thread.learnerId : thread.tutorId;
  try {
    const [recipient, org] = await Promise.all([
      getProfileById(recipientId),
      getOrganizationById(thread.organizationId)
    ]);
    await emitNotification({
      type: 'message.received',
      recipients: [
        {
          userId: recipientId,
          email: recipient?.email ?? null,
          emailFields: {
            threadUrl: `${getAppBaseUrl()}/messages/${threadId}`,
            branding: buildEmailBranding({ name: org?.name ?? '', avatarUrl: org?.avatarUrl, theme: org?.theme })
          }
        }
      ],
      entityType: 'message_thread',
      entityId: threadId,
      actorId: actor.userId,
      emailTemplateId: 'messageReceived',
      coalesce: true
    });
  } catch (error) {
    console.error('[messaging] message notification failed (message still sent):', error);
  }

  return { id: row.id, senderId: row.senderId, body: row.body, createdAt: row.createdAt, mine: true };
}
