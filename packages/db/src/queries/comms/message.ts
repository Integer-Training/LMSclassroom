import * as schema from '@db/schema';

import { and, count, db, desc, eq, gt, isNull, lt, ne, or, sql, type DbOrTxClient } from '@db/drizzle';
import { alias } from 'drizzle-orm/pg-core';

// PearlLMS Phase 6 Step 4 — messaging queries (docs/COMMS-MODEL.md §4). A thread is one per (tutor, learner)
// pair; messages are text-only + append-only; read state is a per-participant cursor. These queries do NO
// access control — the service/guard layer enforces participant + allocation + archived rules.

export interface MessageThreadRow {
  id: string;
  organizationId: string;
  tutorId: string;
  learnerId: string;
  archivedAt: string | null;
  createdAt: string;
}

export interface MessageRow {
  id: string;
  threadId: string;
  senderId: string;
  body: string;
  createdAt: string;
}

/** The thread for a pair, or null. */
export async function getThreadByPair(
  tutorId: string,
  learnerId: string,
  client: DbOrTxClient = db
): Promise<MessageThreadRow | null> {
  const [row] = await client
    .select()
    .from(schema.messageThread)
    .where(and(eq(schema.messageThread.tutorId, tutorId), eq(schema.messageThread.learnerId, learnerId)))
    .limit(1);
  return (row as MessageThreadRow) ?? null;
}

export async function getThreadById(threadId: string, client: DbOrTxClient = db): Promise<MessageThreadRow | null> {
  const [row] = await client.select().from(schema.messageThread).where(eq(schema.messageThread.id, threadId)).limit(1);
  return (row as MessageThreadRow) ?? null;
}

/**
 * Ensure an ACTIVE thread exists for the pair: insert, or on conflict CLEAR archived_at (a re-allocated same
 * pair reactivates the existing conversation — D4). UNIQUE(tutor, learner) makes this idempotent.
 */
export async function ensureActiveThread(
  organizationId: string,
  tutorId: string,
  learnerId: string,
  client: DbOrTxClient = db
): Promise<MessageThreadRow> {
  const [row] = await client
    .insert(schema.messageThread)
    .values({ organizationId, tutorId, learnerId })
    .onConflictDoUpdate({
      target: [schema.messageThread.tutorId, schema.messageThread.learnerId],
      set: { archivedAt: null }
    })
    .returning();
  return row as MessageThreadRow;
}

/** Reallocation hook: flip the pair's thread read-only (archived) without deleting it. No-op if none/already. */
export async function archiveThreadForPair(
  tutorId: string,
  learnerId: string,
  client: DbOrTxClient = db
): Promise<number> {
  const rows = await client
    .update(schema.messageThread)
    .set({ archivedAt: sql`now()` })
    .where(
      and(
        eq(schema.messageThread.tutorId, tutorId),
        eq(schema.messageThread.learnerId, learnerId),
        isNull(schema.messageThread.archivedAt)
      )
    )
    .returning({ id: schema.messageThread.id });
  return rows.length;
}

/** Insert one text message (append-only). */
export async function insertMessage(
  threadId: string,
  senderId: string,
  body: string,
  client: DbOrTxClient = db
): Promise<MessageRow> {
  const [row] = await client.insert(schema.message).values({ threadId, senderId, body }).returning();
  return row as MessageRow;
}

/** Default / maximum page size for a thread's messages. */
export const MESSAGE_PAGE_LIMIT = 100;

/**
 * A page of a thread's messages: the NEWEST `limit` (optionally strictly older than the `before` cursor, a
 * message `createdAt`), returned oldest-first so the chat renders in order. `hasMore` says older messages
 * exist (fetches limit+1 to know). Uses the (thread_id, created_at) index; `id` breaks ties deterministically.
 */
export async function listMessagesPage(
  threadId: string,
  opts: { limit?: number; before?: string } = {},
  client: DbOrTxClient = db
): Promise<{ messages: MessageRow[]; hasMore: boolean }> {
  const limit = Math.min(Math.max(opts.limit ?? MESSAGE_PAGE_LIMIT, 1), MESSAGE_PAGE_LIMIT);
  const conditions = [eq(schema.message.threadId, threadId)];
  if (opts.before) conditions.push(lt(schema.message.createdAt, opts.before));

  const rows = (await client
    .select()
    .from(schema.message)
    .where(and(...conditions))
    .orderBy(desc(schema.message.createdAt), desc(schema.message.id))
    .limit(limit + 1)) as MessageRow[];

  const hasMore = rows.length > limit;
  return { messages: rows.slice(0, limit).reverse(), hasMore };
}

/** A thread's newest `limit` messages, oldest-first (chat order). */
export async function listMessages(
  threadId: string,
  opts: { limit?: number; before?: string } = {},
  client: DbOrTxClient = db
): Promise<MessageRow[]> {
  return (await listMessagesPage(threadId, opts, client)).messages;
}

/**
 * "Latest message of the outer thread" as a LATERAL subquery (top-1 by created_at, id desc). The inner join drops
 * threads with no messages, matching the old DISTINCT ON behaviour. Correlated on `message_thread.id`.
 */
function latestMessageLateral(client: DbOrTxClient) {
  return client
    .select({
      body: schema.message.body,
      createdAt: schema.message.createdAt,
      senderId: schema.message.senderId
    })
    .from(schema.message)
    .where(eq(schema.message.threadId, schema.messageThread.id))
    .orderBy(desc(schema.message.createdAt), desc(schema.message.id))
    .limit(1)
    .as('latest_message');
}

// ── Learner home summary (PearlLMS) — unread count + recent threads for the learner's dashboard ──────────

export interface RecentThreadRow {
  threadId: string;
  tutorId: string;
  tutorName: string;
  body: string;
  createdAt: string;
  /** The last message wasn't sent by the learner AND arrived after their read cursor. */
  unread: boolean;
}

export interface LearnerMessageSummary {
  unreadCount: number;
  recent: RecentThreadRow[];
}

/**
 * A learner's messaging summary for the home dashboard: total unread messages + the most-recently-active
 * threads (tutor name + last message + unread flag). Self-scoped by the caller (pass the learner's own id).
 * Unread = a message the OTHER party sent after the learner's read cursor (null cursor = never read → unread).
 */
export async function getLearnerMessageSummary(
  learnerId: string,
  opts: { limit?: number } = {},
  client: DbOrTxClient = db
): Promise<LearnerMessageSummary> {
  const limit = opts.limit ?? 5;

  // Unread messages across ALL the learner's threads (archived included — an unread stays unread).
  const [{ n } = { n: 0 }] = await client
    .select({ n: count() })
    .from(schema.message)
    .innerJoin(schema.messageThread, eq(schema.messageThread.id, schema.message.threadId))
    .leftJoin(
      schema.messageRead,
      and(eq(schema.messageRead.threadId, schema.messageThread.id), eq(schema.messageRead.profileId, learnerId))
    )
    .where(
      and(
        eq(schema.messageThread.learnerId, learnerId),
        ne(schema.message.senderId, learnerId),
        or(isNull(schema.messageRead.lastReadAt), gt(schema.message.createdAt, schema.messageRead.lastReadAt))
      )
    );

  // The latest message per thread via a LATERAL top-1 probe on the (thread_id, created_at) index — one index
  // seek per thread instead of sorting every message the learner has ever received.
  const latest = latestMessageLateral(client);
  const rows = await client
    .select({
      threadId: schema.messageThread.id,
      tutorId: schema.messageThread.tutorId,
      tutorName: schema.profile.fullname,
      body: latest.body,
      createdAt: latest.createdAt,
      senderId: latest.senderId,
      lastReadAt: schema.messageRead.lastReadAt
    })
    .from(schema.messageThread)
    .innerJoinLateral(latest, sql`true`)
    .leftJoin(schema.profile, eq(schema.profile.id, schema.messageThread.tutorId))
    .leftJoin(
      schema.messageRead,
      and(eq(schema.messageRead.threadId, schema.messageThread.id), eq(schema.messageRead.profileId, learnerId))
    )
    .where(eq(schema.messageThread.learnerId, learnerId));

  const recent: RecentThreadRow[] = rows
    .map((r) => ({
      threadId: r.threadId,
      tutorId: r.tutorId,
      tutorName: r.tutorName ?? 'Your tutor',
      body: r.body,
      createdAt: r.createdAt as string,
      unread:
        r.senderId !== learnerId &&
        (!r.lastReadAt || new Date(r.createdAt as string).getTime() > new Date(r.lastReadAt as string).getTime())
    }))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);

  return { unreadCount: Number(n), recent };
}

// ── Conversation list (inbox) — every thread the participant is in, newest-active first ──────────────────

export interface ConversationRow {
  threadId: string;
  counterpartId: string;
  counterpartName: string;
  body: string;
  createdAt: string;
  /** The last message wasn't sent by this participant AND arrived after their read cursor. */
  unread: boolean;
  archived: boolean;
}

/**
 * Every conversation a participant (tutor OR learner) is in — the latest message per thread with the OTHER
 * party's name + an unread flag. Role-general (filters tutor_id OR learner_id = profileId), so it backs both
 * the tutor inbox and a learner inbox. Threads with no messages yet are omitted. No access control here.
 */
export async function listConversationsForParticipant(
  profileId: string,
  client: DbOrTxClient = db
): Promise<ConversationRow[]> {
  const tutorProfile = alias(schema.profile, 'tutor_profile');
  const learnerProfile = alias(schema.profile, 'learner_profile');
  const latest = latestMessageLateral(client);
  const rows = await client
    .select({
      threadId: schema.messageThread.id,
      tutorId: schema.messageThread.tutorId,
      learnerId: schema.messageThread.learnerId,
      tutorName: tutorProfile.fullname,
      learnerName: learnerProfile.fullname,
      archivedAt: schema.messageThread.archivedAt,
      body: latest.body,
      createdAt: latest.createdAt,
      senderId: latest.senderId,
      lastReadAt: schema.messageRead.lastReadAt
    })
    .from(schema.messageThread)
    .innerJoinLateral(latest, sql`true`)
    .leftJoin(tutorProfile, eq(tutorProfile.id, schema.messageThread.tutorId))
    .leftJoin(learnerProfile, eq(learnerProfile.id, schema.messageThread.learnerId))
    .leftJoin(
      schema.messageRead,
      and(eq(schema.messageRead.threadId, schema.messageThread.id), eq(schema.messageRead.profileId, profileId))
    )
    .where(or(eq(schema.messageThread.tutorId, profileId), eq(schema.messageThread.learnerId, profileId)));

  return rows
    .map((r) => {
      const amTutor = r.tutorId === profileId;
      const counterpartId = amTutor ? r.learnerId : r.tutorId;
      const createdAt = r.createdAt as string;
      return {
        threadId: r.threadId,
        counterpartId,
        counterpartName: (amTutor ? r.learnerName : r.tutorName) ?? 'Conversation',
        body: r.body,
        createdAt,
        unread:
          r.senderId !== profileId &&
          (!r.lastReadAt || new Date(createdAt).getTime() > new Date(r.lastReadAt as string).getTime()),
        archived: r.archivedAt != null
      };
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/** Set the participant's read cursor to now (idempotent per (thread, profile)). */
export async function markThreadRead(threadId: string, profileId: string, client: DbOrTxClient = db): Promise<void> {
  await client
    .insert(schema.messageRead)
    .values({ threadId, profileId })
    .onConflictDoUpdate({
      target: [schema.messageRead.threadId, schema.messageRead.profileId],
      set: { lastReadAt: sql`now()` }
    });
}
