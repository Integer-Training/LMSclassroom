import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@cio/db/actor';

// PearlLMS Phase-10 Step-3 fix wave — regression tests for the access findings.
// HP/SW-1: `canReadLearnerProgress` closes the stock GET /course/:courseId/progress?profileId IDOR (any
// enrolled learner could read a classmate's per-unit grades). Self / Admin / Manager / allocated-Tutor only.
// The tutor-allocation query is mocked so the predicate is deterministic.

vi.mock('@cio/db/queries/allocation', () => ({ isTutorAllocatedToLearner: vi.fn() }));

import { isTutorAllocatedToLearner } from '@cio/db/queries/allocation';
import { canReadLearnerProgress } from '@api/middlewares/guards/ownership';

const mAlloc = vi.mocked(isTutorAllocatedToLearner);
const A = (id: string, role: string): Actor =>
  ({ authenticated: true, userId: id, role, status: 'ACTIVE', orgId: 'o1' }) as Actor;
const LEARNER = 'learner-A';

beforeEach(() => {
  vi.clearAllMocks();
  mAlloc.mockResolvedValue(false as never);
});

describe('canReadLearnerProgress (HP/SW-1) — progress IDOR guard', () => {
  it('the learner may read their OWN progress', async () => {
    expect(await canReadLearnerProgress(A(LEARNER, 'LEARNER'), LEARNER)).toBe(true);
  });

  it('a DIFFERENT learner may NOT read it (the IDOR that was open)', async () => {
    expect(await canReadLearnerProgress(A('learner-B', 'LEARNER'), LEARNER)).toBe(false);
  });

  it('Admin and Manager may read any learner in scope', async () => {
    expect(await canReadLearnerProgress(A('u', 'ADMIN'), LEARNER)).toBe(true);
    expect(await canReadLearnerProgress(A('u', 'MANAGER'), LEARNER)).toBe(true);
  });

  it('an ALLOCATED tutor may read; a non-allocated tutor may NOT', async () => {
    mAlloc.mockResolvedValue(true as never);
    expect(await canReadLearnerProgress(A('t1', 'TUTOR'), LEARNER)).toBe(true);
    expect(mAlloc).toHaveBeenCalledWith('t1', LEARNER);
    mAlloc.mockResolvedValue(false as never);
    expect(await canReadLearnerProgress(A('t2', 'TUTOR'), LEARNER)).toBe(false);
  });

  it('anonymous / empty learner id → false', async () => {
    expect(await canReadLearnerProgress({ authenticated: false } as Actor, LEARNER)).toBe(false);
    expect(await canReadLearnerProgress(A(LEARNER, 'LEARNER'), '')).toBe(false);
  });
});
