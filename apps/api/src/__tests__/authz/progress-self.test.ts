import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@cio/db/actor';

// PearlLMS Phase 5 Step 3 — progress is SELF-ONLY. The service computes for the actor's own id; there is no
// learnerId parameter, so a learner cannot request another learner's progress (docs/PROGRESS-MODEL.md §7).

vi.mock('@cio/db/queries/progress', () => ({ computeLearnerCourseProgress: vi.fn() }));

import { computeLearnerCourseProgress } from '@cio/db/queries/progress';
import { getOwnCourseProgress } from '@api/services/progress/progress';

const mCompute = vi.mocked(computeLearnerCourseProgress);

const learnerA: Actor = { authenticated: true, userId: 'learner-A', role: 'LEARNER', status: 'ACTIVE', orgId: 'org-1' };
const learnerB: Actor = { authenticated: true, userId: 'learner-B', role: 'LEARNER', status: 'ACTIVE', orgId: 'org-1' };

beforeEach(() => {
  vi.clearAllMocks();
  mCompute.mockResolvedValue({
    courseId: 'c1',
    passed: 1,
    total: 3,
    completed: false,
    completedAt: null,
    currentPosition: { lessonId: 's2', title: 'Session 2', index: 2 }
  });
});

describe('getOwnCourseProgress — self only', () => {
  it("computes for the requesting actor's OWN id", async () => {
    await getOwnCourseProgress(learnerA, 'c1');
    expect(mCompute).toHaveBeenCalledWith('learner-A', 'c1');
  });

  it('a different learner gets THEIR own id — the two never cross', async () => {
    await getOwnCourseProgress(learnerA, 'c1');
    await getOwnCourseProgress(learnerB, 'c1');
    expect(mCompute).toHaveBeenNthCalledWith(1, 'learner-A', 'c1');
    expect(mCompute).toHaveBeenNthCalledWith(2, 'learner-B', 'c1');
    // learner A's call never carried learner B's id, and vice versa
    const ids = mCompute.mock.calls.map((c) => c[0]);
    expect(ids).toEqual(['learner-A', 'learner-B']);
  });

  it('takes no learner id from the caller — only the actor + course id are inputs', () => {
    // The signature is (actor, courseId): there is structurally no way to pass a foreign learner id.
    expect(getOwnCourseProgress.length).toBe(2);
  });
});
