import { beforeEach, describe, expect, it, vi } from 'vitest';

// PearlLMS Phase 5 Step 3 — the shared progress computation (docs/PROGRESS-MODEL.md §3), TEST-FIRST.
// Fixtures: fresh (nothing passed), mid-chain (some passed), completed (all passed). Exempt units
// (induction / id-check) are excluded from BOTH numerator and denominator. DB reads are mocked.

vi.mock('@cio/db/queries/gating', () => ({ getOrderedUnitsForCourse: vi.fn() }));
vi.mock('@cio/db/queries/coursework', () => ({ hasLearnerPassedUnit: vi.fn() }));
vi.mock('@cio/db/queries/completion', () => ({ getCourseCompletion: vi.fn() }));

import { getOrderedUnitsForCourse } from '@cio/db/queries/gating';
import { hasLearnerPassedUnit } from '@cio/db/queries/coursework';
import { getCourseCompletion } from '@cio/db/queries/completion';
import { computeLearnerCourseProgress } from '@cio/db/queries/progress';

const mUnits = vi.mocked(getOrderedUnitsForCourse);
const mPassed = vi.mocked(hasLearnerPassedUnit);
const mCompletion = vi.mocked(getCourseCompletion);

const L = 'learner-1';
const C = 'course-1';
const unit = (lessonId: string, unitType: string | null, title: string) => ({ lessonId, unitType, title });

function passedSet(...lessonIds: string[]) {
  const set = new Set(lessonIds);
  mPassed.mockImplementation(async (_l: string, lessonId: string) => set.has(lessonId));
}

// A representative iCQ-shaped course: 2 exempt (induction, id-check) + 3 non-exempt sessions.
const ICQ_UNITS = [
  unit('ind', 'induction', 'Induction'),
  unit('idc', 'id-check', 'ID check'),
  unit('s1', 'session', 'Session 1'),
  unit('s2', 'session', 'Session 2'),
  unit('s3', 'portfolio-review', 'Portfolio review')
];

beforeEach(() => {
  vi.clearAllMocks();
  mCompletion.mockResolvedValue(null as never);
});

describe('computeLearnerCourseProgress — exempt units excluded from numerator + denominator', () => {
  it('fresh learner: 0 of 3, current position = first non-exempt session', async () => {
    mUnits.mockResolvedValue(ICQ_UNITS as never);
    passedSet();
    const p = await computeLearnerCourseProgress(L, C);
    expect(p.total).toBe(3); // 3 non-exempt (the 2 exempt excluded)
    expect(p.passed).toBe(0);
    expect(p.completed).toBe(false);
    expect(p.currentPosition).toEqual({ lessonId: 's1', title: 'Session 1', index: 1 });
  });

  it('mid-chain learner: passed session 1 → 1 of 3, on session 2', async () => {
    mUnits.mockResolvedValue(ICQ_UNITS as never);
    passedSet('s1');
    const p = await computeLearnerCourseProgress(L, C);
    expect(p.passed).toBe(1);
    expect(p.total).toBe(3);
    expect(p.currentPosition).toEqual({ lessonId: 's2', title: 'Session 2', index: 2 });
    expect(p.completed).toBe(false);
  });

  it('completed learner: all non-exempt passed → 3 of 3, no current position, completed date shown', async () => {
    mUnits.mockResolvedValue(ICQ_UNITS as never);
    passedSet('s1', 's2', 's3');
    mCompletion.mockResolvedValue({
      id: 'cc1',
      learnerId: L,
      courseId: C,
      completedAt: '2026-08-17T10:00:00Z',
      createdAt: 'x'
    } as never);
    const p = await computeLearnerCourseProgress(L, C);
    expect(p.passed).toBe(3);
    expect(p.total).toBe(3);
    expect(p.completed).toBe(true);
    expect(p.currentPosition).toBeNull();
    expect(p.completedAt).toBe('2026-08-17T10:00:00Z');
  });

  it('the current position is the LOWEST-order unpassed non-exempt unit (unlock-off, non-contiguous)', async () => {
    mUnits.mockResolvedValue(ICQ_UNITS as never);
    passedSet('s2'); // passed a later one but not s1 (unlock-off scenario)
    const p = await computeLearnerCourseProgress(L, C);
    expect(p.passed).toBe(1);
    expect(p.currentPosition).toEqual({ lessonId: 's1', title: 'Session 1', index: 1 }); // still points at s1
    expect(p.completed).toBe(false); // not complete despite passed>0
  });

  it('a course with only exempt units → 0 of 0, no position, not completed', async () => {
    mUnits.mockResolvedValue([unit('ind', 'induction', 'Induction'), unit('idc', 'id-check', 'ID check')] as never);
    passedSet();
    const p = await computeLearnerCourseProgress(L, C);
    expect(p.total).toBe(0);
    expect(p.passed).toBe(0);
    expect(p.completed).toBe(false);
    expect(p.currentPosition).toBeNull();
  });
});
