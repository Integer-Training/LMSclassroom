import { beforeEach, describe, expect, it, vi } from 'vitest';

// Phase D — the generated SQL of the heartbeat-path queries, captured by swapping the postgres client's `unsafe` for a
// recorder (no database is ever contacted). Locks: touchSession only rewrites a session older than 45s, and the
// learner unit-time check is ONE query binding the enrolment (STUDENT groupmember of the course) to the lesson's course.

// SAFETY: pin an unreachable DATABASE_URL BEFORE the query modules are imported (they build the client at import time).
vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
  process.env.PRIVATE_DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
});

const calls: Array<{ query: string; params: unknown[] }> = [];
let nextRows: unknown[] = [];

import { SESSION_TOUCH_MIN_AGE_MS, touchSession } from '@cio/db/queries/organization';
import { getUnitTimeBeatTarget } from '@cio/db/queries/caseload';

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

describe('touchSession', () => {
  it('is a conditional UPDATE: only a session not touched in the last 45s is rewritten', async () => {
    const before = Date.now();
    await touchSession('sess-1');
    const after = Date.now();

    expect(calls).toHaveLength(1);
    expect(sqlOf()).toMatch(
      /^update "session" set "updated_at" = \$1 where \("session"\."id" = \$2 and "session"\."updated_at" < \$3\)/
    );
    const [setTo, id, cutoff] = calls[0]!.params as [string, string, string];
    expect(id).toBe('sess-1');

    const setMs = Date.parse(setTo);
    const cutoffMs = Date.parse(cutoff);
    expect(setMs).toBeGreaterThanOrEqual(before - 1);
    expect(setMs).toBeLessThanOrEqual(after + 1);
    expect(setMs - cutoffMs).toBe(SESSION_TOUCH_MIN_AGE_MS);
  });

  it('the threshold sits below the jittered heartbeat floor (60s - 20% = 48s) so a single tab always writes', () => {
    expect(SESSION_TOUCH_MIN_AGE_MS).toBe(45_000);
    expect(SESSION_TOUCH_MIN_AGE_MS).toBeLessThan(60_000 * 0.8);
  });
});

describe('getUnitTimeBeatTarget', () => {
  const input = { courseId: 'c1', lessonId: 'l1', profileId: 'p1' };

  it('is ONE query joining the lesson to the course group membership (STUDENT role) of the profile', async () => {
    nextRows = [{ lessonCourseId: 'c1', memberId: 'gm1' }];
    await expect(getUnitTimeBeatTarget(input)).resolves.toBe('OK');

    expect(calls).toHaveLength(1);
    const q = sqlOf();
    expect(q).toMatch(/from "lesson" left join "course" on "course"\."id" = \$\d+ left join "groupmember" on/);
    expect(q).toMatch(/"groupmember"\."group_id" = "course"\."group_id"/);
    expect(q).toMatch(/"groupmember"\."profile_id" = \$\d+/);
    expect(q).toMatch(/"groupmember"\."role_id" = \$\d+/);
    expect(q).toMatch(/where "lesson"\."id" = \$\d+ limit \$\d+/);
    expect(calls[0]!.params).toEqual(expect.arrayContaining(['c1', 'p1', 'l1']));
  });

  it('a lesson of another course (or no lesson) is LESSON_NOT_IN_COURSE', async () => {
    nextRows = [{ lessonCourseId: 'other-course', memberId: 'gm1' }];
    await expect(getUnitTimeBeatTarget(input)).resolves.toBe('LESSON_NOT_IN_COURSE');

    nextRows = [];
    await expect(getUnitTimeBeatTarget(input)).resolves.toBe('LESSON_NOT_IN_COURSE');
  });

  it('a lesson in the course but no STUDENT membership is NOT_ENROLLED_STUDENT', async () => {
    nextRows = [{ lessonCourseId: 'c1', memberId: null }];
    await expect(getUnitTimeBeatTarget(input)).resolves.toBe('NOT_ENROLLED_STUDENT');
  });
});
