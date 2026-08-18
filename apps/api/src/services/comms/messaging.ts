import { AppError, ErrorCodes } from '@api/utils/errors';
import type { Actor } from '@cio/db/actor';
import { MESSAGE_MAX_LENGTH } from '@cio/utils/constants';
import { isTutorAllocatedToLearner, listTutorsForLearner } from '@cio/db/queries/allocation';
import { getProfileById } from '@cio/db/queries/auth';
import { getOrganizationById } from '@cio/db/queries/organization';
import {
  ensureActiveThread,
  getThreadById,
  insertMessage,
  listMessages,
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

async function buildView(
  actor: Extract<Actor, { authenticated: true }>,
  thread: MessageThreadRow
): Promise<ThreadView> {
  const participant = isParticipant(actor, thread);
  // For a participant, the counterpart is the OTHER party; for an Admin overseer, show the learner as subject.
  const counterpartId = actor.userId === thread.tutorId ? thread.learnerId : thread.tutorId;
  const [counterpart, messages, allocated] = await Promise.all([
    getProfileById(counterpartId),
    listMessages(thread.id),
    isTutorAllocatedToLearner(thread.tutorId, thread.learnerId)
  ]);
  const archived = thread.archivedAt != null;

  return {
    threadId: thread.id,
    tutorId: thread.tutorId,
    learnerId: thread.learnerId,
    archived,
    // A participant of an archived pair sees the conversation read-only; an Admin overseer is always read-only.
    readOnly: !participant || archived || !allocated,
    canWrite: participant && !archived && allocated,
    counterpart: { id: counterpartId, name: counterpart?.fullname ?? 'Conversation' },
    messages: messages.map((m) => ({
      id: m.id,
      senderId: m.senderId,
      body: m.body,
      createdAt: m.createdAt,
      mine: m.senderId === actor.userId
    }))
  };
}

/** The learner's allocated tutor (for the "Message your tutor" entry point), or null → empty state. */
export async function getMyTutor(actor: Actor): Promise<{ tutorId: string; name: string } | null> {
  assertAuthed(actor);
  const tutors = await listTutorsForLearner(actor.userId);
  const first = tutors[0];
  if (!first) return null;
  const profile = await getProfileById(first.tutorId);
  return { tutorId: first.tutorId, name: profile?.fullname ?? 'Your tutor' };
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
    throw new AppError('You can only message an allocated tutor/learner', ErrorCodes.FORBIDDEN, 403);
  }

  const thread = await ensureActiveThread(actor.orgId, tutorId, learnerId);
  await markThreadReadQuery(thread.id, actor.userId);
  return buildView(actor, thread);
}

/** View a thread by id — participant OR Admin (D2). A participant's read cursor is advanced on view. */
export async function getThreadView(actor: Actor, threadId: string): Promise<ThreadView> {
  assertAuthed(actor);
  const thread = await getThreadById(threadId);
  if (!thread) throw new AppError('Thread not found', ErrorCodes.NOT_FOUND, 404);

  const participant = isParticipant(actor, thread);
  const isAdmin = actor.role === 'ADMIN';
  if (!participant && !isAdmin) {
    throw new AppError('You do not have access to this conversation', ErrorCodes.FORBIDDEN, 403);
  }
  if (participant) await markThreadReadQuery(thread.id, actor.userId);
  return buildView(actor, thread);
}

/** Mark a thread read for the actor (participant only). */
export async function markThreadRead(actor: Actor, threadId: string): Promise<void> {
  assertAuthed(actor);
  const thread = await getThreadById(threadId);
  if (!thread || !isParticipant(actor, thread)) {
    throw new AppError('You do not have access to this conversation', ErrorCodes.FORBIDDEN, 403);
  }
  await markThreadReadQuery(threadId, actor.userId);
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
      emailTemplateId: 'messageReceived',
      coalesce: true
    });
  } catch (error) {
    console.error('[messaging] message notification failed (message still sent):', error);
  }

  return { id: row.id, senderId: row.senderId, body: row.body, createdAt: row.createdAt, mine: true };
}
