import * as schema from '@db/schema';

import { and, count, db, desc, eq, gte, ilike, inArray, lt, lte, sql, type DbOrTxClient } from '@db/drizzle';

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

/** The org + filter WHERE shared by the page query and the totals query (the limit is NOT part of it). */
function buildConditions(organizationId: string, filters: SystemEventFilters) {
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
  return conditions;
}

/** Org-scoped, newest first. */
export async function getSystemEvents(
  organizationId: string,
  filters: SystemEventFilters = {},
  client: DbOrTxClient = db
): Promise<SystemEventRow[]> {
  const conditions = buildConditions(organizationId, filters);

  const requested = Number.isFinite(filters.limit) ? Math.floor(filters.limit as number) : DEFAULT_LIMIT;
  const limit = Math.min(Math.max(requested, 1), MAX_LIMIT);

  return client
    .select()
    .from(schema.systemEventLog)
    .where(and(...conditions))
    .orderBy(desc(schema.systemEventLog.occurredAt))
    .limit(limit);
}

/**
 * Total rows matching the filters (ignoring `limit`) and the per-severity breakdown — one grouped COUNT using the
 * same WHERE as the page, so the numbers describe the whole filtered set rather than just the rows returned.
 */
export async function getSystemEventTotals(
  organizationId: string,
  filters: SystemEventFilters = {},
  client: DbOrTxClient = db
): Promise<{ total: number; bySeverity: Record<string, number> }> {
  const rows = await client
    .select({ severity: schema.systemEventLog.severity, n: count() })
    .from(schema.systemEventLog)
    .where(and(...buildConditions(organizationId, filters)))
    .groupBy(schema.systemEventLog.severity);

  const bySeverity: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    bySeverity[r.severity] = Number(r.n);
    total += Number(r.n);
  }
  return { total, bySeverity };
}

/** Org-wide error / failed-login counts since `sinceIso` (the KPI tiles) — one `count(*) FILTER` scan, no row fetch. */
export async function countSystemEventsSince(
  organizationId: string,
  sinceIso: string,
  client: DbOrTxClient = db
): Promise<{ errors: number; failedLogins: number }> {
  const [row] = await client
    .select({
      errors: sql<number>`count(*) filter (where ${schema.systemEventLog.severity} = 'error')`.mapWith(Number),
      failedLogins:
        sql<number>`count(*) filter (where ${schema.systemEventLog.eventType} = 'auth.login.failure')`.mapWith(Number)
    })
    .from(schema.systemEventLog)
    .where(
      and(eq(schema.systemEventLog.organizationId, organizationId), gte(schema.systemEventLog.occurredAt, sinceIso))
    );
  return { errors: row?.errors ?? 0, failedLogins: row?.failedLogins ?? 0 };
}

/** Rows deleted per statement by the retention purge — keeps each DELETE short (no long locks / WAL spike). */
export const SYSTEM_EVENT_PURGE_BATCH = 5000;

/**
 * Retention purge. Deletes in batches of `batchSize` (`DELETE ... WHERE id IN (SELECT id ... LIMIT n)`) until
 * none are left, and returns the number of rows deleted (not their ids).
 */
export async function deleteSystemEventsOlderThan(
  days: number,
  client: DbOrTxClient = db,
  batchSize: number = SYSTEM_EVENT_PURGE_BATCH
): Promise<number> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  let deletedTotal = 0;
  for (;;) {
    const result = await client
      .delete(schema.systemEventLog)
      .where(
        inArray(
          schema.systemEventLog.id,
          client
            .select({ id: schema.systemEventLog.id })
            .from(schema.systemEventLog)
            .where(lt(schema.systemEventLog.occurredAt, cutoff))
            .limit(batchSize)
        )
      );
    const deleted = Number(result.count ?? 0);
    deletedTotal += deleted;
    if (deleted < batchSize) return deletedTotal;
  }
}
