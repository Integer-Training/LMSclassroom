import * as schema from '@db/schema';

import { and, db, desc, eq, gte, ilike, lt, lte, type DbOrTxClient } from '@db/drizzle';

// PearlLMS Phase 10 — system_event_log queries. The WRITER (recordSystemEvent, which masks the IP and caps
// message/stack) lives in src/system-events.ts; insertSystemEvent here is the raw insert it delegates to.

export type SystemEventRow = typeof schema.systemEventLog.$inferSelect;
export type NewSystemEventRow = typeof schema.systemEventLog.$inferInsert;

export interface SystemEventFilters {
  /** ISO timestamp, inclusive lower bound on occurred_at. */
  from?: string;
  /** ISO timestamp, inclusive upper bound on occurred_at. */
  to?: string;
  eventType?: string;
  severity?: string;
  /** Exact http_status match. */
  status?: number;
  /** Case-insensitive substring match on user_email. */
  email?: string;
  /** Default 500, capped at 2000. */
  limit?: number;
}

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;

export async function insertSystemEvent(row: NewSystemEventRow, client: DbOrTxClient = db): Promise<void> {
  await client.insert(schema.systemEventLog).values(row);
}

/** Org-scoped, newest first. */
export async function getSystemEvents(
  organizationId: string,
  filters: SystemEventFilters = {},
  client: DbOrTxClient = db
): Promise<SystemEventRow[]> {
  const conditions = [eq(schema.systemEventLog.organizationId, organizationId)];
  if (filters.from) conditions.push(gte(schema.systemEventLog.occurredAt, filters.from));
  if (filters.to) conditions.push(lte(schema.systemEventLog.occurredAt, filters.to));
  if (filters.eventType) conditions.push(eq(schema.systemEventLog.eventType, filters.eventType));
  if (filters.severity) conditions.push(eq(schema.systemEventLog.severity, filters.severity));
  if (typeof filters.status === 'number' && Number.isFinite(filters.status)) {
    conditions.push(eq(schema.systemEventLog.httpStatus, filters.status));
  }
  if (filters.email) {
    // Escape LIKE wildcards so the admin's text is matched literally.
    const escaped = filters.email.replace(/[\\%_]/g, (c) => `\\${c}`);
    conditions.push(ilike(schema.systemEventLog.userEmail, `%${escaped}%`));
  }

  const requested = Number.isFinite(filters.limit) ? Math.floor(filters.limit as number) : DEFAULT_LIMIT;
  const limit = Math.min(Math.max(requested, 1), MAX_LIMIT);

  return client
    .select()
    .from(schema.systemEventLog)
    .where(and(...conditions))
    .orderBy(desc(schema.systemEventLog.occurredAt))
    .limit(limit);
}

/** Retention purge. Returns the number of rows deleted. */
export async function deleteSystemEventsOlderThan(days: number, client: DbOrTxClient = db): Promise<number> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const deleted = await client
    .delete(schema.systemEventLog)
    .where(lt(schema.systemEventLog.occurredAt, cutoff))
    .returning({ id: schema.systemEventLog.id });
  return deleted.length;
}
