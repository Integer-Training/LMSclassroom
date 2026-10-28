import { beforeEach, describe, expect, it, vi } from 'vitest';

// Phase G — the generated SQL of the bulk enrolment / compliance / notification queries, captured by swapping the
// postgres client's `unsafe` (and `begin`, for transactions) for a recorder. No database is ever contacted.
// Locks: chunked multi-row INSERTs, ON CONFLICT DO NOTHING with RETURNING, one transaction per bulk call, and the
// set-based UPDATE ... IN for compliance.

// SAFETY: the real query modules build a postgres client from DATABASE_URL at import time (and apps/api/.env
// points at a real database). Pin an unreachable URL BEFORE anything is imported.
vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
  process.env.PRIVATE_DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
});

import { addGroupMembers, enrollUsersInCourseGroups, getExistingGroupMembers } from '@cio/db/queries/group';
import { addCohortMembersBulk, getExistingCohortMembers } from '@cio/db/queries/cohort';
import { insertNotificationsBatch } from '@cio/db/queries/comms';
import { EmailPreferenceLookupCache } from '@cio/db/queries/notifications';
import {
  createCourseCompletionRecordsBulk,
  createCourseCompletionRecordsIfAbsentBulk,
  updateCourseCompletionRecordsByIds
} from '@cio/db/queries/course/compliance';

const calls: Array<{ query: string; params: unknown[] }> = [];
let begins = 0;
/** Rows handed back per statement; a function so a test can vary by statement text. */
let rowsFor: (query: string) => unknown[][] = () => [];

function makeUnsafe() {
  return (query: string, params: unknown[]) => {
    calls.push({ query, params });
    const rows = rowsFor(query);
    const out = Object.assign([...rows], { count: rows.length });
    const p = Promise.resolve(out) as Promise<unknown> & { values: () => Promise<unknown[]> };
    p.values = () => Promise.resolve(rows);
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

const sqlOf = (i: number) => calls[i]!.query.replace(/\s+/g, ' ');
const dummyRow = () => Array.from({ length: 24 }, () => null);

beforeEach(() => {
  installRecorder();
  calls.length = 0;
  begins = 0;
  rowsFor = () => [];
});

describe('group bulk enrolment', () => {
  const members = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      groupId: '00000000-0000-0000-0000-000000000001',
      roleId: 3,
      profileId: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`
    }));

  it('addGroupMembers chunks 1,200 rows into 3 INSERTs inside ONE transaction, ON CONFLICT (group_id, profile_id) DO NOTHING RETURNING', async () => {
    await addGroupMembers(members(1200));
    expect(begins).toBe(1);
    const inserts = calls.filter((c) => /^insert into "groupmember"/i.test(c.query.trim()));
    expect(inserts).toHaveLength(3);
    for (const c of inserts) {
      expect(c.query.replace(/\s+/g, ' ')).toContain('on conflict ("group_id","profile_id") do nothing returning');
    }
    // 500 + 500 + 200 rows
    const paramCounts = inserts.map((c) => c.params.length);
    expect(paramCounts[0]).toBe(paramCounts[1]);
    expect(paramCounts[2]).toBeLessThan(paramCounts[0]!);
  });

  it('addGroupMembers returns ONLY the rows RETURNING gave back (skipped conflicts are not counted)', async () => {
    rowsFor = () => [dummyRow(), dummyRow()];
    const inserted = await addGroupMembers(members(5));
    expect(inserted).toHaveLength(2);
  });

  it('addGroupMembers([]) does nothing (no transaction, no statement)', async () => {
    expect(await addGroupMembers([])).toEqual([]);
    expect(begins).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it('getExistingGroupMembers chunks the profile ids (500 per IN list)', async () => {
    const pairs = members(1100).map((m) => ({ groupId: m.groupId, profileId: m.profileId }));
    await getExistingGroupMembers(pairs);
    expect(calls).toHaveLength(3);
  });

  it('enrollUsersInCourseGroups reports the inserted count from RETURNING, not the attempted count', async () => {
    // lookup returns nothing existing; the insert only lands 1 of the 2 (the other was enrolled concurrently)
    rowsFor = (q) => (/^insert/i.test(q.trim()) ? [dummyRow()] : []);
    const n = await enrollUsersInCourseGroups(
      ['00000000-0000-0000-0000-0000000000a1'],
      [{ profileId: '00000000-0000-0000-0000-000000000001' }, { profileId: '00000000-0000-0000-0000-000000000002' }],
      3
    );
    expect(n).toBe(1);
  });
});

describe('cohort bulk add', () => {
  it('addCohortMembersBulk is a chunked ON CONFLICT DO NOTHING insert returning the new rows', async () => {
    const rows = Array.from({ length: 501 }, (_, i) => ({
      cohortId: '00000000-0000-0000-0000-0000000000c1',
      roleId: 3,
      profileId: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`
    }));
    await addCohortMembersBulk(rows);
    expect(calls).toHaveLength(2);
    expect(sqlOf(0)).toMatch(/^insert into "cohort_member"/i);
    expect(sqlOf(0)).toContain('on conflict do nothing returning');
  });

  it('getExistingCohortMembers chunks the profile ids', async () => {
    const pairs = Array.from({ length: 1001 }, (_, i) => ({
      cohortId: '00000000-0000-0000-0000-0000000000c1',
      profileId: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`
    }));
    await getExistingCohortMembers(pairs);
    expect(calls).toHaveLength(3);
  });
});

describe('notification batch insert', () => {
  it('is ONE multi-row INSERT returning (id, user_id)', async () => {
    await insertNotificationsBatch([
      { userId: '00000000-0000-0000-0000-000000000001', type: 'announcement.published' },
      { userId: '00000000-0000-0000-0000-000000000002', type: 'announcement.published' }
    ]);
    expect(calls).toHaveLength(1);
    expect(sqlOf(0)).toMatch(/^insert into "notification" \("id", "user_id", "type", "entity_type", "entity_id"/i);
    expect(sqlOf(0)).toMatch(/returning "id", "user_id"$/);
    expect(calls[0]!.params.filter((p) => p === 'announcement.published')).toHaveLength(2);
  });

  it('an empty batch issues no statement', async () => {
    expect(await insertNotificationsBatch([])).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe('compliance bulk', () => {
  const rec = (i: number) => ({
    courseId: '00000000-0000-0000-0000-0000000000c1',
    groupMemberId: i,
    profileId: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
    cycleNumber: 1,
    status: 'not_started' as const,
    dueDate: '2027-01-01T00:00:00.000Z',
    attempts: 0,
    timeSpentMinutes: 0
  });

  it('createCourseCompletionRecordsIfAbsentBulk is ON CONFLICT (course, profile, cycle) DO NOTHING RETURNING, chunked', async () => {
    await createCourseCompletionRecordsIfAbsentBulk(Array.from({ length: 501 }, (_, i) => rec(i)));
    expect(calls).toHaveLength(2);
    expect(sqlOf(0)).toContain('on conflict ("course_id","profile_id","cycle_number") do nothing returning');
  });

  it('createCourseCompletionRecordsBulk is a plain chunked INSERT (a duplicate must still raise)', async () => {
    await createCourseCompletionRecordsBulk(Array.from({ length: 3 }, (_, i) => rec(i)));
    expect(calls).toHaveLength(1);
    expect(sqlOf(0)).not.toContain('on conflict');
  });

  it('updateCourseCompletionRecordsByIds is one UPDATE ... WHERE id IN (...) per 500 ids and sums the rows updated', async () => {
    rowsFor = () => [['x'], ['y']];
    const ids = Array.from({ length: 1001 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`);
    const updated = await updateCourseCompletionRecordsByIds(ids, { status: 'waived' });
    expect(calls).toHaveLength(3);
    expect(sqlOf(0)).toMatch(/^update "course_completion_record" set .* where "course_completion_record"\."id" in \(/);
    expect(updated).toBe(6); // 3 statements x 2 mocked rows
  });

  it('no ids means no statement', async () => {
    expect(await updateCourseCompletionRecordsByIds([], { status: 'waived' })).toBe(0);
    expect(calls).toHaveLength(0);
  });
});

describe('email preference prefetch (read batching only)', () => {
  it('prefetchPersonalSettings loads many recipients with ONE organizationmember LEFT JOIN query per 500', async () => {
    const cache = new EmailPreferenceLookupCache();
    const ids = Array.from({ length: 501 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`);
    await cache.prefetchPersonalSettings(ids, '00000000-0000-0000-0000-0000000000a0');
    expect(calls).toHaveLength(2);
    expect(sqlOf(0)).toMatch(/from "organizationmember" left join "organizationmember_email_notifications"/);
    expect(sqlOf(0)).toMatch(
      /"organizationmember"\."organization_id" = \$\d+ and "organizationmember"\."profile_id" in \(/
    );
  });

  it('a second prefetch for already-loaded profiles issues no query', async () => {
    const cache = new EmailPreferenceLookupCache();
    const org = '00000000-0000-0000-0000-0000000000a0';
    await cache.prefetchPersonalSettings(['00000000-0000-0000-0000-000000000001'], org);
    calls.length = 0;
    await cache.prefetchPersonalSettings(['00000000-0000-0000-0000-000000000001'], org);
    expect(calls).toHaveLength(0);
  });
});
