import * as schema from '@db/schema';

import { and, db, desc, eq, gte, inArray, isNull, ne, notExists, sql, type DbOrTxClient } from '@db/drizzle';

// PearlLMS Phase 6 — in-app notification centre queries (docs/COMMS-MODEL.md §4-5). The centre is strictly
// SELF-scoped: every read/mutation is filtered by user_id at the query layer; there is no cross-user path.

export interface NotificationRow {
  id: string;
  userId: string;
  type: string;
  entityType: string | null;
  entityId: string | null;
  createdAt: string;
  readAt: string | null;
  /** Who caused it (null on rows written before actor tracking). */
  actorId: string | null;
  /** Submission type (draft | final) for submission/result rows; null otherwise. */
  variant: string | null;
}

export interface InsertNotificationInput {
  userId: string;
  type: string;
  entityType?: string | null;
  entityId?: string | null;
  actorId?: string | null;
  variant?: string | null;
}

/** Write one in-app notification row (the framework always does this, regardless of email preference). */
export async function insertNotification(
  input: InsertNotificationInput,
  client: DbOrTxClient = db
): Promise<NotificationRow> {
  const [row] = await client
    .insert(schema.notification)
    .values({
      userId: input.userId,
      type: input.type,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      actorId: input.actorId ?? null,
      variant: input.variant ?? null
    })
    .returning();
  return row as NotificationRow;
}

/**
 * Write many in-app rows in ONE multi-row INSERT (Phase G broadcast fan-out). Callers chunk (see
 * emitNotificationBatch) and fall back to per-row inserts if a chunk fails.
 */
export async function insertNotificationsBatch(
  inputs: InsertNotificationInput[],
  client: DbOrTxClient = db
): Promise<Array<{ id: string; userId: string }>> {
  if (inputs.length === 0) return [];
  return client
    .insert(schema.notification)
    .values(
      inputs.map((input) => ({
        userId: input.userId,
        type: input.type,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        actorId: input.actorId ?? null,
        variant: input.variant ?? null
      }))
    )
    .returning({ id: schema.notification.id, userId: schema.notification.userId });
}

/** A user's own notifications, newest first (self-scoped — caller passes the actor's own id). */
export async function listNotificationsForUser(
  userId: string,
  opts: { limit?: number; offset?: number } = {},
  client: DbOrTxClient = db
): Promise<NotificationRow[]> {
  const rows = await client
    .select()
    .from(schema.notification)
    .where(eq(schema.notification.userId, userId))
    .orderBy(desc(schema.notification.createdAt))
    .limit(opts.limit ?? 30)
    .offset(opts.offset ?? 0);
  return rows as NotificationRow[];
}

/** Count a user's unread notifications (the bell badge). */
export async function countUnreadNotifications(userId: string, client: DbOrTxClient = db): Promise<number> {
  const [row] = await client
    .select({ n: sql<number>`count(*)` })
    .from(schema.notification)
    .where(and(eq(schema.notification.userId, userId), isNull(schema.notification.readAt)));
  return Number(row?.n ?? 0);
}

/** Mark ONE notification read — scoped to the owner (a foreign id affects nothing). */
export async function markNotificationRead(id: string, userId: string, client: DbOrTxClient = db): Promise<number> {
  const rows = await client
    .update(schema.notification)
    .set({ readAt: sql`now()` })
    .where(
      and(eq(schema.notification.id, id), eq(schema.notification.userId, userId), isNull(schema.notification.readAt))
    )
    .returning({ id: schema.notification.id });
  return rows.length;
}

/**
 * Mark a user's unread notifications about ONE subject (entity_type, entity_id) read — e.g. the bell's
 * "New message" rows once the thread itself has been read elsewhere. Self-scoped by user_id.
 */
export async function markNotificationsReadForEntity(
  userId: string,
  entityType: string,
  entityId: string,
  client: DbOrTxClient = db
): Promise<number> {
  const rows = await client
    .update(schema.notification)
    .set({ readAt: sql`now()` })
    .where(
      and(
        eq(schema.notification.userId, userId),
        eq(schema.notification.entityType, entityType),
        eq(schema.notification.entityId, entityId),
        isNull(schema.notification.readAt)
      )
    )
    .returning({ id: schema.notification.id });
  return rows.length;
}

/** Mark ALL of a user's unread notifications read. */
export async function markAllNotificationsRead(userId: string, client: DbOrTxClient = db): Promise<number> {
  const rows = await client
    .update(schema.notification)
    .set({ readAt: sql`now()` })
    .where(and(eq(schema.notification.userId, userId), isNull(schema.notification.readAt)))
    .returning({ id: schema.notification.id });
  return rows.length;
}

/**
 * Coalescing check (docs/COMMS-MODEL.md D3): does the user already have ANOTHER unread notification for the
 * same subject (entity_type, entity_id), newer than the backstop window? If so, a further email is suppressed
 * (the in-app row still fires). `excludeId` is the just-written row so it never coalesces against itself.
 */
export async function hasRecentUnreadForEntity(
  userId: string,
  entityType: string | null,
  entityId: string,
  excludeId: string | null,
  windowMs: number,
  client: DbOrTxClient = db
): Promise<boolean> {
  const cutoffSql = sql`now() - (${windowMs} || ' milliseconds')::interval`;
  const [row] = await client
    .select({ n: sql<number>`count(*)` })
    .from(schema.notification)
    .where(
      and(
        eq(schema.notification.userId, userId),
        entityType === null ? isNull(schema.notification.entityType) : eq(schema.notification.entityType, entityType),
        eq(schema.notification.entityId, entityId),
        isNull(schema.notification.readAt),
        gte(schema.notification.createdAt, cutoffSql),
        excludeId ? ne(schema.notification.id, excludeId) : sql`true`
      )
    );
  return Number(row?.n ?? 0) > 0;
}

/**
 * Resolve lesson entity ids → their course + title, so the notification centre can build a deep link
 * (`/courses/{courseId}/lessons/{lessonId}`) and a subject line. Batched (one query for the whole page).
 * The link is a convenience — the target surface's own guards remain the access control.
 */
export async function getLessonLinkTargets(
  lessonIds: string[],
  client: DbOrTxClient = db
): Promise<Map<string, { courseId: string; title: string | null }>> {
  if (lessonIds.length === 0) return new Map();
  const rows = await client
    .select({ id: schema.lesson.id, courseId: schema.lesson.courseId, title: schema.lesson.title })
    .from(schema.lesson)
    .where(inArray(schema.lesson.id, lessonIds));
  return new Map(rows.map((r) => [r.id, { courseId: r.courseId as string, title: r.title ?? null }]));
}

/**
 * After a tutor loses learners (switch / move): clear THAT tutor's unread bell items about them. Two kinds:
 *  - `message.received` whose entity is the tutor↔learner thread;
 *  - `submission.created` (entity = lesson) for lessons where one of those learners has a submission AND no
 *    learner still allocated to the tutor has a latest version awaiting marking there (so a lesson that is
 *    still waiting on the tutor's remaining learners keeps its alert). Call AFTER the allocations moved.
 * Self-scoped by user_id (the tutor). Returns the number of rows marked read.
 */
export async function markTutorNotificationsReadForLearners(
  tutorId: string,
  learnerIds: string[],
  client: DbOrTxClient = db
): Promise<number> {
  if (learnerIds.length === 0) return 0;
  const n = schema.notification;
  let marked = 0;

  const threadIds = client
    .select({ id: schema.messageThread.id })
    .from(schema.messageThread)
    .where(and(eq(schema.messageThread.tutorId, tutorId), inArray(schema.messageThread.learnerId, learnerIds)));
  const msgRows = await client
    .update(n)
    .set({ readAt: sql`now()` })
    .where(and(eq(n.userId, tutorId), eq(n.type, 'message.received'), isNull(n.readAt), inArray(n.entityId, threadIds)))
    .returning({ id: n.id });
  marked += msgRows.length;

  const cs = schema.courseworkSubmission;
  const lessonRows = await client
    .selectDistinct({ lessonId: cs.lessonId })
    .from(cs)
    .where(inArray(cs.learnerId, learnerIds));
  const lessonIds = lessonRows.map((r) => r.lessonId);
  if (lessonIds.length > 0) {
    // Lessons where a learner the tutor STILL has has an unmarked latest version — those alerts stay.
    const stillWaiting = await client
      .selectDistinct({ lessonId: cs.lessonId })
      .from(cs)
      .innerJoin(
        schema.tutorAllocation,
        and(eq(schema.tutorAllocation.learnerId, cs.learnerId), eq(schema.tutorAllocation.tutorId, tutorId))
      )
      .where(
        and(
          inArray(cs.lessonId, lessonIds),
          sql`${cs.version} = (select max(s2.version) from coursework_submission s2 where s2.learner_id = ${cs.learnerId} and s2.lesson_id = ${cs.lessonId})`,
          notExists(
            client
              .select({ one: sql`1` })
              .from(schema.courseworkResult)
              .where(eq(schema.courseworkResult.submissionId, cs.id))
          )
        )
      );
    const keep = new Set(stillWaiting.map((r) => r.lessonId));
    const clearIds = lessonIds.filter((id) => !keep.has(id));
    if (clearIds.length > 0) {
      const subRows = await client
        .update(n)
        .set({ readAt: sql`now()` })
        .where(
          and(
            eq(n.userId, tutorId),
            eq(n.type, 'submission.created'),
            eq(n.entityType, 'lesson'),
            isNull(n.readAt),
            inArray(n.entityId, clearIds)
          )
        )
        .returning({ id: n.id });
      marked += subRows.length;
    }
  }
  return marked;
}
