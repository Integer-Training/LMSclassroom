import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@cio/db/actor';
import { ZCourseDownloadPresignedUrl } from '@cio/utils/validation/course';

// Scalability Phase F2/F3 — the download guards. Same decisions as before, fewer round-trips:
//  - materials: ONE key→unit map read serves currency AND unlock; each distinct unit is evaluated once;
//  - coursework: keys route to the owning table by prefix (feedback keys no longer scan the submission table
//    first), resolve in parallel, and the allocation check runs once per owning learner per request.
// Access semantics (all-or-nothing, owning-row learnerId, Manager denied, legacy fallback) are unchanged.

vi.mock('@cio/db/queries/group', () => ({ isCourseGroupMember: vi.fn(async () => true) }));
vi.mock('@cio/db/queries/course', () => ({
  getCourseById: vi.fn(async () => [{ isPublished: true, status: 'ACTIVE' }])
}));
vi.mock('@cio/db/queries/gating', () => ({
  getCourseSequentialUnlock: vi.fn(),
  getOrderedUnitsForCourse: vi.fn()
}));
vi.mock('@cio/db/queries/lesson', () => ({ getMaterialKeyLessonMap: vi.fn(), getCourseMaterialKeys: vi.fn() }));
vi.mock('@cio/db/queries/allocation', () => ({
  isTutorAllocatedToLearner: vi.fn(),
  listAllocatedLearnerIdsForCourse: vi.fn()
}));
vi.mock('@cio/db/queries/coursework', () => {
  const hasLearnerPassedUnit = vi.fn();
  return {
    hasLearnerPassedUnit,
    getPassedLessonIdsForLearnerCourse: vi.fn(async (learnerId: string, _c: string, _cl: unknown, ids: string[]) => {
      const passed = new Set<string>();
      for (const id of ids) if (await hasLearnerPassedUnit(learnerId, id)) passed.add(id);
      return passed;
    }),
    getSubmissionByFileKey: vi.fn(),
    getSubmissionByFeedbackFileKey: vi.fn()
  };
});

import { getCourseSequentialUnlock, getOrderedUnitsForCourse } from '@cio/db/queries/gating';
import { getCourseMaterialKeys, getMaterialKeyLessonMap } from '@cio/db/queries/lesson';
import { isTutorAllocatedToLearner } from '@cio/db/queries/allocation';
import {
  getPassedLessonIdsForLearnerCourse,
  getSubmissionByFeedbackFileKey,
  getSubmissionByFileKey,
  hasLearnerPassedUnit
} from '@cio/db/queries/coursework';
import { assertCourseMaterialDownloadAccess, assertCourseworkDownloadAccess } from '@api/middlewares/guards';

const mToggle = vi.mocked(getCourseSequentialUnlock);
const mUnits = vi.mocked(getOrderedUnitsForCourse);
const mKeyMap = vi.mocked(getMaterialKeyLessonMap);
const mLegacyKeys = vi.mocked(getCourseMaterialKeys);
const mPassed = vi.mocked(hasLearnerPassedUnit);
const mBatched = vi.mocked(getPassedLessonIdsForLearnerCourse);
const mBySub = vi.mocked(getSubmissionByFileKey);
const mByFeedback = vi.mocked(getSubmissionByFeedbackFileKey);
const mAllocated = vi.mocked(isTutorAllocatedToLearner);

const ORG = 'org-1';
const learner: Actor = { authenticated: true, userId: 'L', role: 'LEARNER', status: 'ACTIVE', orgId: ORG };
const tutor: Actor = { authenticated: true, userId: 'T', role: 'TUTOR', status: 'ACTIVE', orgId: ORG };
const admin: Actor = { authenticated: true, userId: 'A', role: 'ADMIN', status: 'ACTIVE', orgId: ORG };
const manager: Actor = { authenticated: true, userId: 'M', role: 'MANAGER', status: 'ACTIVE', orgId: ORG };

async function status(p: Promise<unknown>): Promise<number> {
  return p.then(() => 0).catch((e) => (e as { statusCode?: number })?.statusCode ?? -1);
}

beforeEach(() => {
  vi.clearAllMocks();
  mToggle.mockReset();
  mUnits.mockReset();
  mKeyMap.mockReset();
  mPassed.mockReset();
  mBySub.mockReset();
  mByFeedback.mockReset();
  mAllocated.mockReset();
  delete process.env.PROGRESS_BATCHED;
});

// ── F2: material download guard ─────────────────────────────────────────────────────────────────
describe('assertCourseMaterialDownloadAccess — F2 batching', () => {
  // u1 → u2 → u3, all gating sessions. Keys: two in u3, one in u2, one in u1.
  const UNITS = [
    { lessonId: 'u1', unitType: 'session' },
    { lessonId: 'u2', unitType: 'session' },
    { lessonId: 'u3', unitType: 'session' }
  ];
  const MAP = new Map([
    ['materials/c1/a.pdf', 'u3'],
    ['materials/c1/b.pdf', 'u3'],
    ['materials/c1/c.pdf', 'u2'],
    ['materials/c1/d.pdf', 'u1']
  ]);

  beforeEach(() => {
    mToggle.mockResolvedValue(true);
    mUnits.mockResolvedValue(UNITS as never);
    mKeyMap.mockResolvedValue(MAP as never);
  });

  it('reads the key→unit map ONCE (no separate current-key read) and evaluates each distinct unit once', async () => {
    mPassed.mockImplementation(async (_l, id) => id === 'u1' || id === 'u2'); // u3's gate (u2) passed
    const keys = ['materials/c1/a.pdf', 'materials/c1/b.pdf', 'materials/c1/c.pdf', 'materials/c1/d.pdf'];
    expect(await status(assertCourseMaterialDownloadAccess(learner, 'c1', keys))).toBe(0);

    expect(mKeyMap).toHaveBeenCalledTimes(1);
    expect(mLegacyKeys).not.toHaveBeenCalled();
    expect(mToggle).toHaveBeenCalledTimes(1); // sequential flag loaded once
    expect(mUnits).toHaveBeenCalledTimes(1); // ordered units loaded once
    expect(mBatched).toHaveBeenCalledTimes(1); // ONE batched passed-read for all gate predecessors
    expect(mBatched.mock.calls[0]![3]!.sort()).toEqual(['u1', 'u2']); // u3 and u2's predecessors; u1 has none
  });

  it('a key of a LOCKED unit among many → 403 (all-or-nothing); unlocking the predecessor allows it', async () => {
    mPassed.mockImplementation(async (_l, id) => id === 'u1'); // u2 not passed → u3 locked, u2 open
    const keys = ['materials/c1/c.pdf', 'materials/c1/a.pdf'];
    expect(await status(assertCourseMaterialDownloadAccess(learner, 'c1', keys))).toBe(403);
    expect(await status(assertCourseMaterialDownloadAccess(learner, 'c1', ['materials/c1/c.pdf']))).toBe(0);
    mPassed.mockImplementation(async () => true);
    expect(await status(assertCourseMaterialDownloadAccess(learner, 'c1', keys))).toBe(0);
  });

  it('a key that is not a CURRENT material of the course → 403 before any unlock work', async () => {
    expect(
      await status(assertCourseMaterialDownloadAccess(learner, 'c1', ['materials/c1/a.pdf', 'materials/c2/x.pdf']))
    ).toBe(403);
    expect(mToggle).not.toHaveBeenCalled();
  });

  it('sequential unlock OFF → open, no unit/pass reads at all', async () => {
    mToggle.mockResolvedValue(false);
    expect(await status(assertCourseMaterialDownloadAccess(learner, 'c1', ['materials/c1/a.pdf']))).toBe(0);
    expect(mUnits).not.toHaveBeenCalled();
    expect(mBatched).not.toHaveBeenCalled();
  });

  it('exempt / optional and first-gating units are open without asking about passes', async () => {
    mUnits.mockResolvedValue([
      { lessonId: 'u1', unitType: 'induction' },
      { lessonId: 'u2', unitType: 'session' },
      { lessonId: 'u3', unitType: 'session', isOptional: true }
    ] as never);
    mKeyMap.mockResolvedValue(
      new Map([
        ['k-ind', 'u1'],
        ['k-first', 'u2'],
        ['k-opt', 'u3']
      ]) as never
    );
    expect(await status(assertCourseMaterialDownloadAccess(learner, 'c1', ['k-ind', 'k-first', 'k-opt']))).toBe(0);
    expect(mBatched).not.toHaveBeenCalled();
  });

  it('PROGRESS_BATCHED=false → per-unit isUnitUnlocked path, same decisions', async () => {
    process.env.PROGRESS_BATCHED = 'false';
    mPassed.mockImplementation(async (_l, id) => id === 'u1');
    expect(await status(assertCourseMaterialDownloadAccess(learner, 'c1', ['materials/c1/a.pdf']))).toBe(403);
    expect(await status(assertCourseMaterialDownloadAccess(learner, 'c1', ['materials/c1/c.pdf']))).toBe(0);
    expect(mBatched).not.toHaveBeenCalled();
  });

  it('staff are never gated and never read the map (authoring flow unchanged)', async () => {
    expect(await status(assertCourseMaterialDownloadAccess(admin, 'c1', ['anything.pdf']))).toBe(0);
    expect(mKeyMap).not.toHaveBeenCalled();
  });
});

describe('ZCourseDownloadPresignedUrl — F2 validation caps', () => {
  const COURSE = '3f0e2a5c-9c6e-4f6c-8f55-2a8d6f3f1c11';
  it('accepts the real callers (one key, optional uuid courseId)', () => {
    expect(ZCourseDownloadPresignedUrl.safeParse({ keys: ['materials/x/a.pdf'], courseId: COURSE }).success).toBe(true);
    expect(ZCourseDownloadPresignedUrl.safeParse({ keys: ['a'] }).success).toBe(true);
  });
  it('rejects >100 keys, a >1024-char key, an empty list and a non-uuid courseId', () => {
    expect(
      ZCourseDownloadPresignedUrl.safeParse({ keys: Array.from({ length: 101 }, (_, i) => `k${i}`) }).success
    ).toBe(false);
    expect(
      ZCourseDownloadPresignedUrl.safeParse({ keys: Array.from({ length: 100 }, (_, i) => `k${i}`) }).success
    ).toBe(true);
    expect(ZCourseDownloadPresignedUrl.safeParse({ keys: ['x'.repeat(1025)] }).success).toBe(false);
    expect(ZCourseDownloadPresignedUrl.safeParse({ keys: ['x'.repeat(1024)] }).success).toBe(true);
    expect(ZCourseDownloadPresignedUrl.safeParse({ keys: [] }).success).toBe(false);
    expect(ZCourseDownloadPresignedUrl.safeParse({ keys: ['a'], courseId: 'not-a-uuid' }).success).toBe(false);
  });
});

// ── F3: coursework download guard ───────────────────────────────────────────────────────────────
describe('assertCourseworkDownloadAccess — F3 routing, parallelism, allocation memo', () => {
  const sub = (learnerId: string) => ({ id: `s-${learnerId}`, learnerId, courseId: 'c1', lessonId: 'l1' }) as never;
  const SUBKEY = (l: string, n = 1) => `coursework/c1/${l}/l1/ws/${n}/work.docx`;
  const FBKEY = (l: string, n = 1) => `coursework-feedback/c1/${l}/l1/ws/${n}/fb.docx`;

  it('routes by prefix: a coursework/ key hits ONLY the submission table, a feedback key ONLY the result table', async () => {
    mBySub.mockResolvedValue(sub('L'));
    mByFeedback.mockResolvedValue(sub('L'));
    expect(await status(assertCourseworkDownloadAccess(learner, [SUBKEY('L')]))).toBe(0);
    expect(mBySub).toHaveBeenCalledTimes(1);
    expect(mByFeedback).not.toHaveBeenCalled();

    vi.clearAllMocks();
    expect(await status(assertCourseworkDownloadAccess(learner, [FBKEY('L')]))).toBe(0);
    expect(mByFeedback).toHaveBeenCalledTimes(1);
    expect(mBySub).not.toHaveBeenCalled(); // no wasted scan of the submission table first
  });

  it('a miss on the preferred table still falls back to the other (legacy containment fallback stays)', async () => {
    mBySub.mockResolvedValue(null);
    mByFeedback.mockResolvedValue(sub('L'));
    expect(await status(assertCourseworkDownloadAccess(learner, [SUBKEY('L')]))).toBe(0);
    mBySub.mockResolvedValue(sub('L'));
    mByFeedback.mockResolvedValue(null);
    expect(await status(assertCourseworkDownloadAccess(learner, ['legacy-unprefixed-key.docx']))).toBe(0);
  });

  it('unknown or malformed keys are denied (403), never signed', async () => {
    mBySub.mockResolvedValue(null);
    mByFeedback.mockResolvedValue(null);
    for (const key of [SUBKEY('L', 9), FBKEY('L', 9), '', '../../etc/passwd', 'coursework/']) {
      expect(await status(assertCourseworkDownloadAccess(learner, [key])), key).toBe(403);
    }
  });

  it('resolves keys in PARALLEL (all lookups start before any resolves)', async () => {
    let inFlight = 0;
    let peak = 0;
    mBySub.mockImplementation(async () => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((r) => setTimeout(r, 15));
      inFlight--;
      return sub('L');
    });
    const keys = Array.from({ length: 8 }, (_, i) => SUBKEY('L', i + 1));
    expect(await status(assertCourseworkDownloadAccess(learner, keys))).toBe(0);
    expect(peak).toBe(8);
  });

  it('all-or-nothing: one unreadable key among many → 403', async () => {
    mBySub.mockImplementation(async (key: string) => sub(key.includes('/L/') ? 'L' : 'OTHER'));
    expect(
      await status(assertCourseworkDownloadAccess(learner, [SUBKEY('L', 1), SUBKEY('OTHER', 2), SUBKEY('L', 3)]))
    ).toBe(403);
    expect(await status(assertCourseworkDownloadAccess(learner, [SUBKEY('L', 1), SUBKEY('L', 3)]))).toBe(0);
  });

  it('access is decided on the OWNING ROW learnerId, never one parsed from the key', async () => {
    // The key path says /L/ but the row belongs to OTHER → the learner L is refused.
    mBySub.mockResolvedValue(sub('OTHER'));
    expect(await status(assertCourseworkDownloadAccess(learner, [SUBKEY('L')]))).toBe(403);
    // And the reverse: a key that LOOKS like OTHER's but the row is L's is allowed for L.
    mBySub.mockResolvedValue(sub('L'));
    expect(await status(assertCourseworkDownloadAccess(learner, [SUBKEY('OTHER')]))).toBe(0);
  });

  it('allocation is checked ONCE per learner per request (memo is per call, never across calls)', async () => {
    mBySub.mockImplementation(async (key: string) => sub(key.includes('/L1/') ? 'L1' : 'L2'));
    mAllocated.mockResolvedValue(true);
    const keys = [SUBKEY('L1', 1), SUBKEY('L1', 2), SUBKEY('L1', 3), SUBKEY('L2', 1), SUBKEY('L2', 2)];
    expect(await status(assertCourseworkDownloadAccess(tutor, keys))).toBe(0);
    expect(mAllocated).toHaveBeenCalledTimes(2);

    // A SECOND request re-checks: de-allocation takes effect on the next request.
    mAllocated.mockImplementation(async (_t, learnerId) => learnerId !== 'L2');
    expect(await status(assertCourseworkDownloadAccess(tutor, keys))).toBe(403);
    expect(mAllocated).toHaveBeenCalledTimes(4);
  });

  it('role matrix is unchanged: allocated tutor ok, non-allocated tutor 403, learner self ok, admin ok, Manager 403', async () => {
    mBySub.mockResolvedValue(sub('L'));
    mAllocated.mockResolvedValueOnce(true);
    expect(await status(assertCourseworkDownloadAccess(tutor, [SUBKEY('L')]))).toBe(0);
    mAllocated.mockResolvedValueOnce(false);
    expect(await status(assertCourseworkDownloadAccess(tutor, [SUBKEY('L')]))).toBe(403);
    expect(await status(assertCourseworkDownloadAccess(learner, [SUBKEY('L')]))).toBe(0);
    expect(await status(assertCourseworkDownloadAccess(admin, [SUBKEY('L')]))).toBe(0);
    expect(await status(assertCourseworkDownloadAccess(manager, [SUBKEY('L')]))).toBe(403);
  });

  it('duplicate keys are looked up once; an empty list is still a 400', async () => {
    mBySub.mockResolvedValue(sub('L'));
    expect(await status(assertCourseworkDownloadAccess(learner, [SUBKEY('L'), SUBKEY('L')]))).toBe(0);
    expect(mBySub).toHaveBeenCalledTimes(1);
    expect(await status(assertCourseworkDownloadAccess(learner, []))).toBe(400);
  });
});
