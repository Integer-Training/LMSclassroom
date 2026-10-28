import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@cio/db/actor';

// Phase H1 — the progression builder: (1) the per-course "latest marked results" read runs ONCE per course and is
// handed to getCourseProgressReport (it used to run twice: once for the pass set, once inside the report);
// (2) the per-course work is bounded to 4 courses in flight; (3) the numbers are unchanged. Also covers mapLimit.
// DB reads mocked.

const H = vi.hoisted(() => ({
  inFlight: 0,
  maxInFlight: 0,
  latestCalls: [] as string[],
  reportArgs: [] as unknown[][]
}));

vi.mock('@cio/db/queries/allocation', () => ({
  listAllocatedLearnersForOrg: vi.fn(async () => []),
  listLearnersForTutor: vi.fn(async () => [])
}));
vi.mock('@cio/db/queries/dash', () => ({
  listOrgLearners: vi.fn(async () =>
    Array.from({ length: 9 }, (_, i) => ({ learnerId: `l${i + 1}`, name: `L ${i + 1}`, email: null }))
  )
}));
vi.mock('@cio/db/queries/caseload', () => ({
  getCoursesForLearners: vi.fn(async () => []),
  // learner l{n} is enrolled in course c{n} only -> 9 distinct target courses
  getEnrolmentsForLearners: vi.fn(async () =>
    Array.from({ length: 9 }, (_, i) => ({
      learnerId: `l${i + 1}`,
      courseId: `c${i + 1}`,
      title: `C${i + 1}`,
      enrolledAt: '2026-01-01'
    }))
  ),
  getProfileStatusForIds: vi.fn(async () => new Map()),
  getUnitTimeForLearners: vi.fn(async () => [])
}));
vi.mock('@cio/db/queries/progress', () => ({ computeLearnerCourseProgress: vi.fn() }));
vi.mock('@cio/db/queries/gating', () => ({
  getOrderedUnitsForCourse: vi.fn(async () => {
    H.inFlight++;
    H.maxInFlight = Math.max(H.maxInFlight, H.inFlight);
    await new Promise((r) => setTimeout(r, 5));
    H.inFlight--;
    return [{ lessonId: 'les-1' }];
  })
}));
vi.mock('@cio/db/queries/coursework', () => ({
  getAssessmentItemsByLesson: vi.fn(async () => new Map([['les-1', [{ key: 'wb', kind: 'workbook' }]]])),
  getSubmissionsWithContextForLearners: vi.fn(async () => [])
}));
vi.mock('@cio/db/queries/reports', () => ({
  getLatestMarkedResultsForCourse: vi.fn(async (courseId: string) => {
    H.latestCalls.push(courseId);
    return [{ learnerId: `l${courseId.slice(1)}`, lessonId: 'les-1', assessmentKey: 'wb', result: 'PASS' }];
  }),
  getCourseProgressReport: vi.fn(async (courseId: string, _client: unknown, prefetched?: { results?: unknown[] }) => {
    H.reportArgs.push([courseId, prefetched]);
    return {
      courseId,
      rows: [{ learnerId: `l${courseId.slice(1)}`, passed: 1, total: 2, currentPosition: { index: 3 } }]
    };
  })
}));
vi.mock('@cio/db/queries/analytics', () => ({ getLastSeenForUserIds: vi.fn(async () => new Map()) }));
vi.mock('@api/middlewares/guards', () => ({ isAllocatedTutor: vi.fn(async () => false) }));

import { getOrgProgression } from '@api/services/progression/progression';
import { mapLimit } from '@api/utils/map-limit';

const admin = { authenticated: true, userId: 'u', role: 'ADMIN', status: 'ACTIVE', orgId: 'o1' } as Actor;

beforeEach(() => {
  H.inFlight = 0;
  H.maxInFlight = 0;
  H.latestCalls = [];
  H.reportArgs = [];
});

describe('getOrgProgression — per-course reads', () => {
  it('reads the latest marked results ONCE per target course and hands them to the progress report', async () => {
    const out = await getOrgProgression(admin);
    const targets = [...new Set(H.latestCalls)];
    expect(H.latestCalls).toHaveLength(targets.length); // never twice for the same course
    expect(targets.length).toBe(9);
    for (const [courseId, prefetched] of H.reportArgs as [string, { results: unknown[] }][]) {
      expect(prefetched.results).toEqual([
        { learnerId: `l${courseId.slice(1)}`, lessonId: 'les-1', assessmentKey: 'wb', result: 'PASS' }
      ]);
      expect(targets).toContain(courseId);
    }
    // numbers unchanged: l1's target course is its most-recent enrolment; 1/2 passed -> 50%, index 3; WB passed via the pass set
    const l1 = out.rows.find((r) => r.learnerId === 'l1')!;
    expect(l1.currentPercent).toBe(50);
    expect(l1.currentUnitIndex).toBe(3);
    expect(l1.workbooks).toEqual({ passed: 1, total: 1 });
  });

  it('never has more than 4 courses in flight at once', async () => {
    await getOrgProgression(admin);
    expect(H.maxInFlight).toBeGreaterThan(1); // still concurrent
    expect(H.maxInFlight).toBeLessThanOrEqual(4);
  });
});

describe('mapLimit', () => {
  it('preserves order, honours the limit and returns every result', async () => {
    let live = 0;
    let max = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      live++;
      max = Math.max(max, live);
      await new Promise((r) => setTimeout(r, 3));
      live--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14]);
    expect(max).toBeLessThanOrEqual(3);
  });

  it('handles empty input and rejects on the first failure without starting later work', async () => {
    expect(await mapLimit([], 4, async () => 1)).toEqual([]);
    const started: number[] = [];
    await expect(
      mapLimit([1, 2, 3, 4, 5, 6], 2, async (n) => {
        started.push(n);
        await new Promise((r) => setTimeout(r, 2));
        if (n === 2) throw new Error('boom');
        return n;
      })
    ).rejects.toThrow('boom');
    expect(started.length).toBeLessThan(6);
  });
});
