import * as schema from '@db/schema';

import { and, db, eq, sql, type DbOrTxClient } from '@db/drizzle';

// PearlLMS Phase 6 — per-user, per-category email preference (docs/COMMS-MODEL.md §4). Absence of a row =
// "use the config default"; the service layer applies NOTIFICATION_EMAIL_DEFAULTS when a row is missing.
// Strictly self-scoped (the caller passes the actor's own id).

export interface NotificationPreferenceRow {
  id: string;
  userId: string;
  category: string;
  emailEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** The user's preference row for a category, or null (→ caller falls back to the config default). */
export async function getNotificationPreference(
  userId: string,
  category: string,
  client: DbOrTxClient = db
): Promise<NotificationPreferenceRow | null> {
  const [row] = await client
    .select()
    .from(schema.notificationPreference)
    .where(and(eq(schema.notificationPreference.userId, userId), eq(schema.notificationPreference.category, category)))
    .limit(1);
  return (row as NotificationPreferenceRow) ?? null;
}

/** All of a user's preference rows (the settings surface reads these + fills gaps from config). */
export async function listNotificationPreferences(
  userId: string,
  client: DbOrTxClient = db
): Promise<NotificationPreferenceRow[]> {
  const rows = await client
    .select()
    .from(schema.notificationPreference)
    .where(eq(schema.notificationPreference.userId, userId));
  return rows as NotificationPreferenceRow[];
}

/** Upsert one (user, category) email toggle. UNIQUE(user, category) makes this idempotent. */
export async function upsertNotificationPreference(
  userId: string,
  category: string,
  emailEnabled: boolean,
  client: DbOrTxClient = db
): Promise<NotificationPreferenceRow> {
  const [row] = await client
    .insert(schema.notificationPreference)
    .values({ userId, category, emailEnabled })
    .onConflictDoUpdate({
      target: [schema.notificationPreference.userId, schema.notificationPreference.category],
      set: { emailEnabled, updatedAt: sql`now()` }
    })
    .returning();
  return row as NotificationPreferenceRow;
}
