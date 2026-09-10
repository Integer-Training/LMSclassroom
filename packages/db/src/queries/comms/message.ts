import * as schema from '@db/schema';

import { and, asc, count, db, desc, eq, gt, isNull, ne, or, sql, type DbOrTxClient } from '@db/drizzle';

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

/** A thread's messages, oldest-first (chat order). Capped; the newest `limit` are returned. */
export async function listMessages(
  threadId: string,
  opts: { limit?: number } = {},
  client: DbOrTxClient = db
): Promise<MessageRow[]> {
  const rows = await client
    .select()
    .from(schema.message)
    .where(eq(schema.message.threadId, threadId))
    .orderBy(asc(schema.message.createdAt))
    .limit(opts.limit ?? 200);
  return rows as MessageRow[];
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
      and(
        eq(schema.messageRead.threadId, schema.messageThread.id),
        eq(schema.messageRead.profileId, learnerId)
      )
    )
    .where(
      and(
        eq(schema.messageThread.learnerId, learnerId),
        ne(schema.message.senderId, learnerId),
        or(
          isNull(schema.messageRead.lastReadAt),
          gt(schema.message.createdAt, schema.messageRead.lastReadAt)
        )
      )
    );

  // The latest message per thread (DISTINCT ON thread, newest first), with tutor name + the read cursor.
  const rows = await client
    .selectDistinctOn([schema.message.threadId], {
      threadId: schema.message.threadId,
      tutorId: schema.messageThread.tutorId,
      tutorName: schema.profile.fullname,
      body: schema.message.body,
      createdAt: schema.message.createdAt,
      senderId: schema.message.senderId,
      lastReadAt: schema.messageRead.lastReadAt
    })
    .from(schema.message)
    .innerJoin(schema.messageThread, eq(schema.messageThread.id, schema.message.threadId))
    .leftJoin(schema.profile, eq(schema.profile.id, schema.messageThread.tutorId))
    .leftJoin(
      schema.messageRead,
      and(
        eq(schema.messageRead.threadId, schema.messageThread.id),
        eq(schema.messageRead.profileId, learnerId)
      )
    )
    .where(eq(schema.messageThread.learnerId, learnerId))
    .orderBy(schema.message.threadId, desc(schema.message.createdAt));

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
