import { sql, type SQL } from 'drizzle-orm';

import { db } from '@db/drizzle';

// Batched retention purges (scalability Phase J, owner decision 5). Every function deletes AT MOST `batchSize` rows
// of one table and returns how many it removed; the maintenance worker loops them (off-peak, paused between batches)
// until a batch comes back short. Each deletes only rows that are expired/terminal AND old enough, by an id sub-select
// with LIMIT so one statement never holds a long lock. NEVER touched here: audit_event (compliance trail), unread
// notifications, coursework/progress tables.

export const RETENTION_DEFAULT_BATCH_SIZE = 5_000;

/** Run a `DELETE ...` and return the number of rows it removed (counted through a data-modifying CTE). */
async function deleteBatch(statement: SQL): Promise<number> {
  const rows = await db.execute(sql`with removed as (${statement} returning 1) select count(*)::int as n from removed`);
  return Number((rows as unknown as Array<{ n?: number }>)[0]?.n ?? 0);
}

/**
 * Better Auth never deletes expired sessions. Expired for more than a day (impersonation sessions share expires_at).
 * "Last seen" = max(analytics_login_events.logged_in_at, session.updated_at) (getLastSeenForUserIds / getLastLogin) and
 * drives the active/inactive/created badges, so a session row is only removed when something at least as recent still
 * carries that user's last-seen: another session with a later updated_at (id breaks ties), or a login event at/after it.
 * The user's newest session therefore survives unless a login event covers it, so last-seen never changes.
 */
export function purgeExpiredSessionsBatch(batchSize = RETENTION_DEFAULT_BATCH_SIZE): Promise<number> {
  return deleteBatch(sql`
    delete from session where id in (
      select s.id from session s
      where s.expires_at < (now() at time zone 'utc') - interval '1 day'
        and (
          exists (
            select 1 from session n
            where n.user_id = s.user_id and n.id <> s.id
              and (n.updated_at > s.updated_at or (n.updated_at = s.updated_at and n.id > s.id))
          )
          or exists (
            select 1 from analytics_login_events l
            where l.user_id = s.user_id and l.logged_in_at >= (s.updated_at at time zone 'utc')
          )
        )
      limit ${batchSize}
    )`);
}

/** Expired verification tokens (email verify / password reset / magic links). */
export function purgeExpiredVerificationsBatch(batchSize = RETENTION_DEFAULT_BATCH_SIZE): Promise<number> {
  return deleteBatch(sql`
    delete from verification where id in (
      select id from verification where expires_at < (now() at time zone 'utc') limit ${batchSize}
    )`);
}

/** READ notifications older than `days` (by read_at). Unread notifications are kept forever. */
export function purgeReadNotificationsBatch(days = 90, batchSize = RETENTION_DEFAULT_BATCH_SIZE): Promise<number> {
  return deleteBatch(sql`
    delete from notification where id in (
      select id from notification
      where read_at is not null and read_at < now() - make_interval(days => ${days}) limit ${batchSize}
    )`);
}

/** Dead-letter records older than `days`. */
export function purgeDeadLetterJobsBatch(days = 90, batchSize = RETENTION_DEFAULT_BATCH_SIZE): Promise<number> {
  return deleteBatch(sql`
    delete from dead_letter_job where id in (
      select id from dead_letter_job where created_at < now() - make_interval(days => ${days}) limit ${batchSize}
    )`);
}

/**
 * Raw analytics page events older than `days` AND already rolled up: never newer than the end of the last day present
 * in analytics_org_daily (no rollup rows at all => nothing is deleted). The daily rollup tables are what dashboards read.
 */
export function purgeRolledUpAnalyticsEventsBatch(
  days = 180,
  batchSize = RETENTION_DEFAULT_BATCH_SIZE
): Promise<number> {
  return deleteBatch(sql`
    delete from analytics_page_event where id in (
      select id from analytics_page_event
      where occurred_at < now() - make_interval(days => ${days})
        and occurred_at < coalesce((select max(date) + 1 from analytics_org_daily)::timestamptz, '-infinity'::timestamptz)
      limit ${batchSize}
    )`);
}

/** Finished job_step ledger rows older than `days` (retries only ever read recent steps). */
export function purgeFinishedJobStepsBatch(days = 90, batchSize = RETENTION_DEFAULT_BATCH_SIZE): Promise<number> {
  return deleteBatch(sql`
    delete from job_step where id in (
      select id from job_step
      where status in ('completed', 'failed', 'canceled') and updated_at < now() - make_interval(days => ${days})
      limit ${batchSize}
    )`);
}

/**
 * Finished media_job rows older than `days`, EXCEPT the newest run of each asset (the UI shows the latest job per
 * asset) and any run a transcript still points at.
 */
export function purgeFinishedMediaJobsBatch(days = 90, batchSize = RETENTION_DEFAULT_BATCH_SIZE): Promise<number> {
  return deleteBatch(sql`
    delete from media_job where id in (
      select mj.id from media_job mj
      where mj.status in ('completed', 'failed', 'canceled')
        and mj.updated_at < now() - make_interval(days => ${days})
        and exists (select 1 from media_job newer where newer.asset_id = mj.asset_id and newer.created_at > mj.created_at)
        and not exists (select 1 from media_transcript t where t.media_job_id = mj.id)
      limit ${batchSize}
    )`);
}
