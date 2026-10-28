import { beforeEach, describe, expect, it, vi } from 'vitest';

// Phase E — the generated SQL of the rewritten queries, captured by swapping the postgres client's `unsafe` for a
// recorder (no database is ever contacted).
// Locks the shapes that matter for scale: newest-N message paging, LATERAL latest-message-per-thread, the
// paginated/stable allocations list, the grouped-count system-event totals and the batched purge.

// SAFETY: this file imports the real query modules, which build a postgres client from DATABASE_URL at import
// time (and apps/api/.env points at a real database). Pin an unreachable URL BEFORE anything is imported so that,
// even if the postgres mock below failed to apply, no statement could ever reach a real database.
vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
  process.env.PRIVATE_DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
});

const calls: Array<{ query: string; params: unknown[] }> = [];
let nextRows: unknown[] = [];

import { listConversationsForParticipant, listMessagesPage, getLearnerMessageSummary } from '@cio/db/queries/comms';
import { createCourseCompletionRecordIfAbsent } from '@cio/db/queries/course/compliance';
import { listAllocationsPageByOrg, searchAssignablePeople } from '@cio/db/queries/allocation';
import {
  countSystemEventsSince,
  deleteSystemEventsOlderThan,
  getSystemEventTotals
} from '@cio/db/queries/system-events';

// The query modules share one lazily-connecting postgres client (stashed on globalThis outside production).
// Replace its statement runner with a recorder that returns `nextRows`.
function installRecorder() {
  const client = (globalThis as unknown as { __cioDatabaseClient?: { unsafe: unknown } }).__cioDatabaseClient;
  if (!client) throw new Error('database client not initialised');
  client.unsafe = (query: string, params: unknown[]) => {
    calls.push({ query, params });
    const rows = Object.assign([...nextRows], { count: nextRows.length });
    const p = Promise.resolve(rows) as Promise<unknown> & { values: () => Promise<unknown[]> };
    p.values = () => Promise.resolve(nextRows.map((r) => Object.values(r as object)));
    return p;
  };
}

const sqlOf = (i = calls.length - 1) => calls[i]!.query.replace(/\s+/g, ' ');

beforeEach(() => {
  installRecorder();
  calls.length = 0;
  nextRows = [];
});

describe('messages', () => {
  it('listMessagesPage fetches the NEWEST page (desc, limit+1) and returns it oldest-first with hasMore', async () => {
    nextRows = [
      { id: 'm3', threadId: 't', senderId: 's', body: 'c', createdAt: '3' },
      { id: 'm2', threadId: 't', senderId: 's', body: 'b', createdAt: '2' },
      { id: 'm1', threadId: 't', senderId: 's', body: 'a', createdAt: '1' }
    ];
    const page = await listMessagesPage('t', { limit: 2 });

    expect(sqlOf()).toMatch(/order by "message"\."created_at" desc, "message"\."id" desc limit \$\d+/);
    expect(calls[0]!.params).toContain(3); // limit + 1 to detect older rows
    expect(page.hasMore).toBe(true);
    expect(page.messages.map((m) => m.id)).toEqual(['m2', 'm3']); // oldest-first window of the newest two
  });

  it('a before cursor adds a strict created_at < bound', async () => {
    await listMessagesPage('t', { before: '2026-10-28 10:00:00+00' });
    expect(sqlOf()).toMatch(/"message"\."created_at" < \$\d+/);
    expect(calls[0]!.params).toContain('2026-10-28 10:00:00+00');
  });

  it('the inbox reads the latest message per thread through a LATERAL top-1 probe (no DISTINCT ON sort)', async () => {
    await listConversationsForParticipant('p1');
    const q = sqlOf();
    expect(q).toMatch(
      /inner join lateral \(select "body", "created_at", "sender_id" from "message" where "message"\."thread_id" = "message_thread"\."id" order by "message"\."created_at" desc, "message"\."id" desc limit \$\d+\)/
    );
    expect(q).not.toMatch(/distinct on/);
  });

  it('the learner summary latest-per-thread also uses LATERAL', async () => {
    await getLearnerMessageSummary('l1');
    const lateral = calls.find((c) => /inner join lateral/.test(c.query));
    expect(lateral).toBeDefined();
    expect(lateral!.query).not.toMatch(/distinct on/i);
  });
});

describe('allocations', () => {
  it('the table page is org-scoped, stably ordered (created_at, id) and offset/limit bounded', async () => {
    await listAllocationsPageByOrg('o1', { page: 3, limit: 25, tutorId: 'tu', search: 'ann' });
    const q = sqlOf(calls.length - 1);
    expect(q).toMatch(/"tutor_allocation"\."organization_id" = \$\d+/);
    expect(q).toMatch(/"tutor_allocation"\."tutor_id" = \$\d+/);
    expect(q).toMatch(/ilike/);
    expect(q).toMatch(
      /order by "tutor_allocation"\."created_at" asc, "tutor_allocation"\."id" asc limit \$\d+ offset \$\d+/
    );
    const params = calls[calls.length - 1]!.params;
    expect(params).toContain(25);
    expect(params).toContain(50); // (page 3 - 1) * 25
  });

  it('limit is capped at 100 rows per page', async () => {
    await listAllocationsPageByOrg('o1', { limit: 5000 });
    expect(calls[calls.length - 1]!.params).toContain(100);
  });

  it('the picker is ACTIVE-only, role-scoped, capped at 20 and excludes already-paired people server-side', async () => {
    await searchAssignablePeople('o1', { role: 3, search: 'bo', excludePairedWith: 'tutor-1' });
    const q = sqlOf();
    expect(q).toMatch(/"profile"\."status" = \$\d+/);
    expect(q).toMatch(/"organizationmember"\."role_id" = \$\d+/);
    expect(q).toMatch(
      /not exists \(select 1 from "tutor_allocation" where \("tutor_allocation"\."tutor_id" = \$\d+ and "tutor_allocation"\."learner_id" = "profile"\."id"\)\)/
    );
    expect(q).toMatch(/limit \$\d+$/);
    expect(calls[0]!.params).toContain(20);
    expect(calls[0]!.params).toContain('ACTIVE');
  });

  it('the picker limit never exceeds 50', async () => {
    await searchAssignablePeople('o1', { role: 2, limit: 9999 });
    expect(calls[0]!.params).toContain(50);
  });
});

describe('compliance', () => {
  it('the next-cycle insert is ON CONFLICT DO NOTHING on (course, profile, cycle) and yields null when it already exists', async () => {
    nextRows = [];
    const created = await createCourseCompletionRecordIfAbsent({
      courseId: 'c',
      groupMemberId: 1,
      profileId: 'p',
      cycleNumber: 2,
      status: 'not_started',
      dueDate: '2027-01-01T00:00:00.000Z',
      attempts: 0,
      timeSpentMinutes: 0
    } as never);
    expect(sqlOf()).toContain('on conflict ("course_id","profile_id","cycle_number") do nothing returning');
    expect(created).toBeNull();
  });
});

describe('system events', () => {
  it('totals are one grouped COUNT over the filter (no limit)', async () => {
    nextRows = [
      { severity: 'error', n: 4 },
      { severity: 'info', n: 6 }
    ];
    const t = await getSystemEventTotals('o1', { severity: 'error', limit: 10 });
    const q = sqlOf();
    expect(q).toMatch(/count\(\*\)/);
    expect(q).toMatch(/group by "system_event_log"\."severity"/);
    expect(q).not.toMatch(/ limit /);
    expect(t.total).toBe(10);
    expect(t.bySeverity).toEqual({ error: 4, info: 6 });
  });

  it('the 24h tile counts are a single count(*) FILTER scan', async () => {
    nextRows = [{ errors: 2, failedLogins: 1 }];
    await countSystemEventsSince('o1', '2026-10-27T00:00:00.000Z');
    expect(sqlOf()).toMatch(/count\(\*\) filter \(where "severity" = 'error'\)/);
    expect(sqlOf()).toMatch(/count\(\*\) filter \(where "event_type" = 'auth\.login\.failure'\)/);
  });

  it('the purge deletes in id batches and stops after a short batch (returns a count, not ids)', async () => {
    nextRows = []; // fake driver reports count 0 -> first batch is short -> loop ends
    const deleted = await deleteSystemEventsOlderThan(90, undefined, 5000);
    const q = sqlOf();
    expect(q).toMatch(
      /delete from "system_event_log" where "system_event_log"\."id" in \(select "id" from "system_event_log" where "system_event_log"\."occurred_at" < \$\d+ limit \$\d+\)/
    );
    expect(q).not.toMatch(/returning/);
    expect(calls).toHaveLength(1);
    expect(deleted).toBe(0);
  });
});
