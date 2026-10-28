import { beforeEach, describe, expect, it, vi } from 'vitest';

// Phase J (maintenance-retention-not-wired, unbounded-tables, db-pool-and-timeouts) — the generated SQL of the batched
// retention purges and of the transaction-local statement_timeout, captured by swapping the postgres client's
// `unsafe` / `begin` for a recorder. No database is ever contacted.
// Locks: only expired/old/terminal rows, a LIMIT on every batch, unread notifications kept, analytics events only
// once rolled up, the newest media_job per asset kept, audit_event never touched, and the 20s cap being LOCAL.

// SAFETY: the real query modules build a postgres client from DATABASE_URL at import time (and apps/api/.env points
// at a real database). Pin an unreachable URL BEFORE anything is imported.
vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
  process.env.PRIVATE_DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
});

import { db, withReportTimeout, withStatementTimeout } from '@cio/db/drizzle';
import {
  purgeDeadLetterJobsBatch,
  purgeExpiredSessionsBatch,
  purgeExpiredVerificationsBatch,
  purgeFinishedJobStepsBatch,
  purgeFinishedMediaJobsBatch,
  purgeReadNotificationsBatch,
  purgeRolledUpAnalyticsEventsBatch
} from '@cio/db/queries/retention';
import { getCompletionStats } from '@cio/db/queries/dash';

const calls: Array<{ query: string; params: unknown[] }> = [];
let begins = 0;
let rowsFor: (query: string) => unknown[] = () => [{ n: 0 }];

function makeUnsafe() {
  return (query: string, params: unknown[]) => {
    calls.push({ query, params });
    const rows = rowsFor(query);
    const out = Object.assign([...rows], { count: rows.length });
    const p = Promise.resolve(out) as Promise<unknown> & { values: () => Promise<unknown[]> };
    p.values = () => Promise.resolve(rows.map((r) => Object.values(r as object)));
    return p;
  };
}

function installRecorder() {
  const client = (globalThis as unknown as { __cioDatabaseClient?: Record<string, unknown> }).__cioDatabaseClient;
  if (!client) throw new Error('database client not initialised');
  client.unsafe = makeUnsafe();
  client.begin = async (fn: (sql: unknown) => Promise<unknown>) => {
    begins += 1;
    return fn({ unsafe: makeUnsafe() });
  };
}

const flat = (i = calls.length - 1) => calls[i]!.query.replace(/\s+/g, ' ');

beforeEach(() => {
  installRecorder();
  calls.length = 0;
  begins = 0;
  rowsFor = () => [{ n: 0 }];
  vi.unstubAllEnvs();
});

describe('batched retention purges', () => {
  it('every purge is a LIMITed id sub-select delete inside a counting CTE, and returns the deleted count', async () => {
    rowsFor = () => [{ n: 42 }];
    const fns = [
      () => purgeExpiredSessionsBatch(100),
      () => purgeExpiredVerificationsBatch(100),
      () => purgeReadNotificationsBatch(90, 100),
      () => purgeDeadLetterJobsBatch(90, 100),
      () => purgeRolledUpAnalyticsEventsBatch(180, 100),
      () => purgeFinishedJobStepsBatch(90, 100),
      () => purgeFinishedMediaJobsBatch(90, 100)
    ];

    for (const run of fns) {
      calls.length = 0;
      expect(await run()).toBe(42);
      expect(calls).toHaveLength(1);
      const q = flat(0);
      expect(q).toMatch(/^with removed as \( delete from \w+ where id in \(/i);
      expect(q).toMatch(/limit \$\d+/i);
      expect(q).toMatch(/returning 1\) select count\(\*\)::int as n from removed/i);
      expect(calls[0]!.params).toContain(100); // the batch size is a bound parameter
    }
  });

  it('sessions: only those expired for more than a day; verifications: only expired', async () => {
    await purgeExpiredSessionsBatch();
    expect(flat()).toContain("expires_at < (now() at time zone 'utc') - interval '1 day'");
    expect(flat()).toContain('delete from session');

    await purgeExpiredVerificationsBatch();
    expect(flat()).toContain("expires_at < (now() at time zone 'utc')");
    expect(flat()).toContain('delete from verification');
  });

  it('notifications: READ ones older than the window only (unread kept forever)', async () => {
    await purgeReadNotificationsBatch(90);
    const q = flat();
    expect(q).toContain('delete from notification');
    expect(q).toContain('read_at is not null and read_at < now() - make_interval(days => $1)');
    expect(calls[0]!.params[0]).toBe(90);
  });

  it('analytics events: older than 180 days AND already rolled up (no rollup rows => nothing deleted)', async () => {
    await purgeRolledUpAnalyticsEventsBatch();
    const q = flat();
    expect(q).toContain('delete from analytics_page_event');
    expect(q).toContain('occurred_at < now() - make_interval(days => $1)');
    expect(q).toContain(
      "coalesce((select max(date) + 1 from analytics_org_daily)::timestamptz, '-infinity'::timestamptz)"
    );
    expect(calls[0]!.params[0]).toBe(180);
  });

  it('job_step / media_job: terminal status only; media_job keeps the newest run per asset and any transcript-linked run', async () => {
    await purgeFinishedJobStepsBatch();
    expect(flat()).toContain("status in ('completed', 'failed', 'canceled')");

    await purgeFinishedMediaJobsBatch();
    const q = flat();
    expect(q).toContain("mj.status in ('completed', 'failed', 'canceled')");
    expect(q).toContain('newer.asset_id = mj.asset_id and newer.created_at > mj.created_at');
    expect(q).toContain('not exists (select 1 from media_transcript');
  });

  it('dead_letter_job is purged by age; audit_event is never referenced by any purge', async () => {
    await purgeDeadLetterJobsBatch(90);
    expect(flat()).toContain('delete from dead_letter_job');

    for (const run of [
      () => purgeExpiredSessionsBatch(),
      () => purgeExpiredVerificationsBatch(),
      () => purgeReadNotificationsBatch(),
      () => purgeDeadLetterJobsBatch(),
      () => purgeRolledUpAnalyticsEventsBatch(),
      () => purgeFinishedJobStepsBatch(),
      () => purgeFinishedMediaJobsBatch()
    ]) {
      calls.length = 0;
      await run();
      expect(flat(0)).not.toMatch(/audit_event/i);
    }
  });
});

describe('statement_timeout is transaction-local', () => {
  it('withStatementTimeout sets statement_timeout via set_config(..., true) (== SET LOCAL) inside ONE transaction', async () => {
    const out = await withStatementTimeout(async () => 'result', 20_000);

    expect(out).toBe('result');
    expect(begins).toBe(1);
    expect(flat(0)).toContain("set_config('statement_timeout'");
    expect(flat(0)).toMatch(/set_config\('statement_timeout', \$1, true\)/);
    expect(calls[0]!.params).toEqual(['20000ms']);
  });

  it('withReportTimeout caps a pool-client read (default 20s) and leaves a caller transaction alone', async () => {
    await withReportTimeout(db, async () => 'x');
    expect(begins).toBe(1);
    expect(calls[0]!.params).toEqual(['20000ms']);

    calls.length = 0;
    begins = 0;
    const tx = { __tx: true } as never;
    await withReportTimeout(tx, async (client) => expect(client).toBe(tx));
    expect(begins).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it('REPORT_STATEMENT_TIMEOUT_MS=0 turns the cap off (no transaction)', async () => {
    vi.stubEnv('REPORT_STATEMENT_TIMEOUT_MS', '0');

    await withReportTimeout(db, async () => 'x');

    expect(begins).toBe(0);
  });

  it('a known heavy report read (getCompletionStats) runs under the cap', async () => {
    await getCompletionStats('org-1');

    expect(begins).toBe(1);
    expect(flat(0)).toContain("set_config('statement_timeout'");
    // ...followed by the report's own statements on the same transaction.
    expect(calls.length).toBeGreaterThan(1);
  });
});
