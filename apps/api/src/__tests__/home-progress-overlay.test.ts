import { beforeEach, describe, expect, it, vi } from 'vitest';

// PearlLMS Phase 5 — the LMS-home result-derived progress overlay (docs/PROGRESS-MODEL.md §4). Non-compliance
// courses with non-exempt units get their stock counters replaced by passed/total; compliance courses,
// no-unit courses, and a course whose computation throws keep their stock values (best-effort, never breaks).

vi.mock('@cio/db/queries/progress', () => ({ computeLearnerCourseProgress: vi.fn() }));

import { computeLearnerCourseProgress } from '@cio/db/queries/progress';
import { overlayResultDerivedProgress } from '@api/services/progress/enrolled-progress';

const mProgress = vi.mocked(computeLearnerCourseProgress);
const L = 'learner-1';

beforeEach(() => vi.clearAllMocks());

describe('overlayResultDerivedProgress', () => {
  it('overrides a non-compliance course with result-derived passed/total', async () => {
    mProgress.mockResolvedValue({
      courseId: 'c1',
      passed: 1,
      total: 2,
      completed: false,
      completedAt: null,
      currentPosition: { lessonId: 's2', title: 'S2', index: 2 }
    });
    const courses = [
      { id: 'c1', type: 'SELF_PACED', progressRate: 5, lessonCount: 10, exerciseCount: 3, exercisesCompleted: 2 }
    ];
    await overlayResultDerivedProgress(L, courses);
    expect(courses[0]).toMatchObject({ progressRate: 1, lessonCount: 2, exerciseCount: 0, exercisesCompleted: 0 });
  });

  it('leaves COMPLIANCE courses untouched (never even computes)', async () => {
    const courses = [
      { id: 'cc', type: 'COMPLIANCE', progressRate: 4, lessonCount: 8, exerciseCount: 0, exercisesCompleted: 0 }
    ];
    await overlayResultDerivedProgress(L, courses);
    expect(mProgress).not.toHaveBeenCalled();
    expect(courses[0]).toMatchObject({ progressRate: 4, lessonCount: 8 });
  });

  it('leaves a course with zero non-exempt units at its stock values', async () => {
    mProgress.mockResolvedValue({
      courseId: 'c2',
      passed: 0,
      total: 0,
      completed: false,
      completedAt: null,
      currentPosition: null
    });
    const courses = [
      { id: 'c2', type: 'SELF_PACED', progressRate: 3, lessonCount: 3, exerciseCount: 0, exercisesCompleted: 0 }
    ];
    await overlayResultDerivedProgress(L, courses);
    expect(courses[0]).toMatchObject({ progressRate: 3, lessonCount: 3 });
  });

  it('a computation failure leaves that course stock (never throws)', async () => {
    mProgress.mockRejectedValue(new Error('db down'));
    const courses = [
      { id: 'c3', type: 'SELF_PACED', progressRate: 7, lessonCount: 9, exerciseCount: 0, exercisesCompleted: 0 }
    ];
    await expect(overlayResultDerivedProgress(L, courses)).resolves.toBeUndefined();
    expect(courses[0]).toMatchObject({ progressRate: 7, lessonCount: 9 });
  });

  it('a completed course reports passed === total (so the home Complete bucket picks it up)', async () => {
    mProgress.mockResolvedValue({
      courseId: 'c4',
      passed: 3,
      total: 3,
      completed: true,
      completedAt: '2026-08-18T00:00:00Z',
      currentPosition: null
    });
    const courses = [
      { id: 'c4', type: 'SELF_PACED', progressRate: 0, lessonCount: 10, exerciseCount: 5, exercisesCompleted: 0 }
    ];
    await overlayResultDerivedProgress(L, courses);
    // getCourseContentProgress = (3 + 0) / (3 + 0) = 100% → isStudentCourseComplete === true
    expect(courses[0]).toMatchObject({ progressRate: 3, lessonCount: 3, exerciseCount: 0, exercisesCompleted: 0 });
  });
});
