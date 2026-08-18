import * as schema from '@db/schema';

import { and, db, desc, eq, gte, isNull, ne, sql, type DbOrTxClient } from '@db/drizzle';

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
}

export interface InsertNotificationInput {
  userId: string;
  type: string;
  entityType?: string | null;
  entityId?: string | null;
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
      entityId: input.entityId ?? null
    })
    .returning();
  return row as NotificationRow;
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
