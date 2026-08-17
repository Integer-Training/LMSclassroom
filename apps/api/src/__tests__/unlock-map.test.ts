import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@cio/db/actor';

// PearlLMS Phase 4 Step 3 — the outline unlock-map service. Per-unit lock state for a learner's outline,
// from the SAME rule as isUnitUnlocked (shared walk + passed-helper). Staff + toggle-off → all open; a
// gated learner gets unlocked flags + a lockedByTitle hint (nearest preceding non-exempt session). Mocked DB.

vi.mock('@cio/db/queries/gating', () => ({
  getCourseSequentialUnlock: vi.fn(),
  getOrderedUnitsForCourse: vi.fn()
}));
vi.mock('@cio/db/queries/coursework', () => ({ hasLearnerPassedUnit: vi.fn() }));

import { getCourseSequentialUnlock, getOrderedUnitsForCourse } from '@cio/db/queries/gating';
import { hasLearnerPassedUnit } from '@cio/db/queries/coursework';
import { getCourseUnlockMap } from '@api/services/gating/unlock';

const mToggle = vi.mocked(getCourseSequentialUnlock);
const mUnits = vi.mocked(getOrderedUnitsForCourse);
const mPassed = vi.mocked(hasLearnerPassedUnit);

const ORG = 'org-1';
const learner: Actor = { authenticated: true, userId: 'L', role: 'LEARNER', status: 'ACTIVE', orgId: ORG };
const admin: Actor = { authenticated: true, userId: 'A', role: 'ADMIN', status: 'ACTIVE', orgId: ORG };

// A(session) · Induction(exempt) · C(session): C gates on A (skipping the exempt induction).
const UNITS = [
  { lessonId: 'A', unitType: 'session', title: 'Session A' },
  { lessonId: 'IND', unitType: 'induction', title: 'Induction' },
  { lessonId: 'C', unitType: 'session', title: 'Session C' }
];

beforeEach(() => {
  vi.clearAllMocks();
  mToggle.mockResolvedValue(true);
  mUnits.mockResolvedValue(UNITS as never);
  mPassed.mockResolvedValue(false);
});

describe('getCourseUnlockMap', () => {
  it('STAFF → every unit unlocked, no hints, passed-helper never consulted', async () => {
    const map = await getCourseUnlockMap(admin, 'c1');
    expect(Object.values(map).every((s) => s.unlocked && s.lockedByTitle === null)).toBe(true);
    expect(mPassed).not.toHaveBeenCalled();
  });

  it('toggle OFF → every unit unlocked', async () => {
    mToggle.mockResolvedValue(false);
    const map = await getCourseUnlockMap(learner, 'c1');
    expect(map['C'].unlocked).toBe(true);
    expect(mPassed).not.toHaveBeenCalled();
  });

  it('learner mid-chain: A open (first), Induction open (exempt), C locked with hint = Session A', async () => {
    mPassed.mockResolvedValue(false); // A not passed
    const map = await getCourseUnlockMap(learner, 'c1');
    expect(map['A']).toEqual({ unlocked: true, lockedByTitle: null }); // first non-exempt
    expect(map['IND']).toEqual({ unlocked: true, lockedByTitle: null }); // exempt
    expect(map['C']).toEqual({ unlocked: false, lockedByTitle: 'Session A' }); // gates on A (skips Induction)
    expect(mPassed).toHaveBeenCalledWith('L', 'A');
    expect(mPassed).not.toHaveBeenCalledWith('L', 'IND');
  });

  it('learner: once A is passed, C unlocks (no hint)', async () => {
    mPassed.mockResolvedValue(true);
    const map = await getCourseUnlockMap(learner, 'c1');
    expect(map['C']).toEqual({ unlocked: true, lockedByTitle: null });
  });
});
