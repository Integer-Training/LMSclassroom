import { beforeEach, describe, expect, it, vi } from 'vitest';

// Phase H1 — the generated SQL of the rewritten dashboard queries, captured by swapping the postgres client's
// `unsafe` for a recorder (no database is ever contacted). Locks: the lean submission-status columns, the SQL
// push-downs (course filter, learner allow-list), the pre-aggregated course stats with the decision-#2 order, the
// PASSING_RESULTS parameter in the referral counts, and that empty allow-lists never reach the database.

// SAFETY: the real query modules build a postgres client from DATABASE_URL at import time (and apps/api/.env points
// at a real database). Pin an unreachable URL BEFORE anything is imported.
vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
  process.env.PRIVATE_DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
});

const calls: Array<{ query: string; params: unknown[] }> = [];
let nextRows: unknown[] = [];

import { getSubmissionStatusRowsForLearners } from '@cio/db/queries/coursework';
import { getLastSeenForUserIds } from '@cio/db/queries/analytics';
import { getCourseProgressReport } from '@cio/db/queries/reports';
import { getCourseStats } from '@cio/db/queries/dash';
import {
  getLearnerOpenReferCounts,
  getRecordedCompletionCountsByCourse,
  getReferralLearnerBreakdown,
  getReferralTutorBreakdown
} from '@cio/db/queries/dash';
import { getSubmissionsByCourseIdWithDetails } from '@cio/db/queries/submission';
import { listAllocatedLearnerIdsByTutors } from '@cio/db/queries/allocation';
import { listAnnouncementsForLearner, listAnnouncementsForOrg, listAnnouncementsForTutor } from '@cio/db/queries/comms';
import { PASSING_RESULTS } from '@cio/utils/constants';

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

describe('getSubmissionStatusRowsForLearners', () => {
  it('selects NO files / comment / feedback columns, keeps the joins + newest-first order', async () => {
    await getSubmissionStatusRowsForLearners(['l1', 'l2']);
    const q = sqlOf();
    expect(q).not.toMatch(/"files"/);
    expect(q).not.toMatch(/"comment"/);
    expect(q).not.toMatch(/"feedback"/);
    expect(q).toMatch(/left join "course"/);
    expect(q).toMatch(/left join "lesson"/);
    expect(q).toMatch(/left join "coursework_result"/);
    expect(q).toMatch(/"learner_id" in \(\$\d+, \$\d+\)/);
    expect(q).toMatch(/order by "coursework_submission"\."submitted_at" desc/);
    expect(q).not.toMatch(/"course_id" = \$/); // no course filter unless asked
  });

  it('an optional courseId is pushed into SQL', async () => {
    await getSubmissionStatusRowsForLearners(['l1'], { courseId: 'c9' });
    expect(sqlOf()).toMatch(/"coursework_submission"\."course_id" = \$\d+/);
    expect(calls[0]!.params).toContain('c9');
  });

  it('an empty learner set never reaches the database', async () => {
    expect(await getSubmissionStatusRowsForLearners([])).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe('getSubmissionsByCourseIdWithDetails learner allow-list', () => {
  it('an EMPTY allow-list returns [] without a query (never an unfiltered read)', async () => {
    expect(await getSubmissionsByCourseIdWithDetails('c1', 'e1', undefined, [])).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('a non-empty allow-list is applied as groupmember.profile_id IN (...) in SQL', async () => {
    await getSubmissionsByCourseIdWithDetails('c1', 'e1', undefined, ['p1', 'p2']);
    expect(sqlOf(0)).toMatch(/"groupmember"\."profile_id" in \(\$\d+, \$\d+\)/);
  });

  it('no allow-list (admin) leaves the query unfiltered by profile', async () => {
    await getSubmissionsByCourseIdWithDetails('c1', 'e1');
    expect(sqlOf(0)).not.toMatch(/"groupmember"\."profile_id" in/);
  });
});

describe('getCourseStats (Top courses)', () => {
  it('pre-aggregates students / lessons / completions and orders by MOST enrolled first (decision #2)', async () => {
    await getCourseStats('org-1');
    const q = sqlOf();
    expect(q).toMatch(/left join \(select "course"\."id", COUNT\("groupmember"\."id"\) as "total_students"/);
    expect(q).toMatch(/left join \(select "course"\."id", COUNT\("lesson"\."id"\) as "total_lessons"/);
    expect(q).toMatch(/COUNT\(DISTINCT "lesson_completion"\."id"\) as "completed_lessons"/);
    // Completions only count ENROLLED role-3 students (join on groupmember role + profile).
    expect(q).toMatch(/"lesson_completion"\."profile_id" = "groupmember"\."profile_id"/);
    expect(q).toMatch(/"groupmember"\."role_id" = \$\d+/);
    expect(q).toMatch(
      /order by COALESCE\("total_students", 0\) desc, "course"\."title" asc, "course"\."id" asc limit \$\d+/
    );
    // No least-completed ordering any more.
    expect(q).not.toMatch(/order by .*completed_lessons/);
    expect(calls[0]!.params).toContain(5);
    expect(calls[0]!.params).toContain('ACTIVE');
    expect(calls[0]!.params).toContain('org-1');
  });
});

describe('referral counts bind PASSING_RESULTS as parameters', () => {
  it('tutor breakdown FILTERs on result NOT IN ($passing) — no hard-coded PASS literal', async () => {
    await getReferralTutorBreakdown('org-1');
    const q = sqlOf();
    expect(q).toMatch(/filter \(where "coursework_result"\."result" not in \(\$\d+\)\)/);
    expect(q).not.toMatch(/'PASS'/);
    for (const p of PASSING_RESULTS) expect(calls[0]!.params).toContain(p);
  });

  it('learner breakdown binds the list too', async () => {
    await getReferralLearnerBreakdown('org-1');
    expect(sqlOf()).toMatch(/"coursework_result"\."result" not in \(\$\d+\)/);
    expect(sqlOf()).not.toMatch(/'PASS'/);
  });

  it('open refers: DISTINCT ON subquery counted in SQL with FILTER, grouped per learner', async () => {
    nextRows = [{ learnerId: 'l1', openRefers: 2 }];
    const out = await getLearnerOpenReferCounts('org-1');
    const q = sqlOf();
    expect(q).toMatch(
      /from \(select distinct on \("coursework_submission"\."learner_id", "coursework_submission"\."lesson_id", "coursework_submission"\."assessment_key"\)/
    );
    expect(q).toMatch(/count\(\*\) filter \(where "latest_final_verdict"\."result" not in \(\$\d+\)\)/);
    expect(q).toMatch(/group by "latest_final_verdict"\."learner_id" having count\(\*\) filter/);
    expect(out).toEqual([{ learnerId: 'l1', openRefers: 2 }]);
  });
});

describe('getRecordedCompletionCountsByCourse', () => {
  it('counts distinct recorded completers who are CURRENTLY enrolled students, per course', async () => {
    nextRows = [{ courseId: 'c1', completed: 3 }];
    const out = await getRecordedCompletionCountsByCourse('org-1');
    const q = sqlOf();
    expect(q).toMatch(/count\(distinct "course_completion"\."learner_id"\)/);
    expect(q).toMatch(
      /inner join "groupmember" on \("groupmember"\."group_id" = "course"\."group_id" and "groupmember"\."profile_id" = "course_completion"\."learner_id" and "groupmember"\."role_id" = \$\d+\)/
    );
    expect(q).toMatch(/group by "course_completion"\."course_id"/);
    expect(out).toEqual([{ courseId: 'c1', completed: 3 }]);
  });
});

describe('listAllocatedLearnerIdsByTutors', () => {
  it('one query for many tutors; an empty tutor list never queries', async () => {
    expect((await listAllocatedLearnerIdsByTutors([])).size).toBe(0);
    expect(calls).toHaveLength(0);
    nextRows = [
      { tutorId: 't1', learnerId: 'l1' },
      { tutorId: 't1', learnerId: 'l2' },
      { tutorId: 't2', learnerId: 'l2' }
    ];
    const map = await listAllocatedLearnerIdsByTutors(['t1', 't2', 't3']);
    expect(calls).toHaveLength(1);
    expect(sqlOf()).toMatch(
      /select distinct "tutor_id", "learner_id" from "tutor_allocation" where "tutor_allocation"\."tutor_id" in \(\$\d+, \$\d+, \$\d+\)/
    );
    expect(map.get('t1')).toEqual(['l1', 'l2']);
    expect(map.get('t2')).toEqual(['l2']);
    expect(map.has('t3')).toBe(false);
  });
});

describe('announcement feed paging', () => {
  it('org list: unarchived by default, includeArchived drops the filter, limit is a bound LIMIT', async () => {
    await listAnnouncementsForOrg('org-1', { limit: 20 });
    expect(sqlOf(0)).toMatch(/"announcement"\."archived_at" is null/);
    expect(sqlOf(0)).toMatch(/limit \$\d+/);
    await listAnnouncementsForOrg('org-1', { includeArchived: true });
    expect(sqlOf(1)).not.toMatch(/"archived_at" is null/);
    expect(sqlOf(1)).not.toMatch(/ limit /);
  });

  it('tutor / learner feeds carry the limit and still exclude archived + deleted rows', async () => {
    await listAnnouncementsForTutor('org-1', 't1', { limit: 20 });
    await listAnnouncementsForLearner('org-1', 'l1', { limit: 20 });
    for (const i of [0, 1]) {
      expect(sqlOf(i)).toMatch(/"archived_at" is null/);
      expect(sqlOf(i)).toMatch(/"deleted_at" is null/);
      expect(sqlOf(i)).toMatch(/limit \$\d+/);
    }
  });
});

describe('getLastSeenForUserIds no longer swallows database errors', () => {
  it('rethrows instead of returning an all-null map (which read as "every learner never logged in")', async () => {
    const client = (globalThis as unknown as { __cioDatabaseClient: { unsafe: unknown } }).__cioDatabaseClient;
    client.unsafe = () => {
      const p = Promise.reject(new Error('connection terminated')) as Promise<unknown> & {
        values: () => Promise<unknown[]>;
      };
      p.values = () => Promise.reject(new Error('connection terminated'));
      p.catch(() => undefined);
      return p;
    };
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(getLastSeenForUserIds(['u1', 'u2'])).rejects.toThrow();
    err.mockRestore();
  });

  it('an empty id list is still an empty map with no query', async () => {
    expect((await getLastSeenForUserIds([])).size).toBe(0);
    expect(calls).toHaveLength(0);
  });
});

describe('getCourseProgressReport pre-fetched results', () => {
  const distinctOnCalls = () => calls.filter((c) => /distinct on/i.test(c.query)).length;

  it('runs the latest-results DISTINCT ON read itself when none is supplied', async () => {
    await getCourseProgressReport('c1');
    expect(distinctOnCalls()).toBe(1);
  });

  it('skips that read entirely when the caller hands the results in', async () => {
    await getCourseProgressReport('c1', undefined, { results: [] });
    expect(distinctOnCalls()).toBe(0);
  });
});
