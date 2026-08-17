import { beforeEach, describe, expect, it, vi } from 'vitest';

// PearlLMS Phase 4 Step 2 — the canonical isUnitUnlocked helper, truth table (TEST-FIRST, written before
// any implementation). Per docs/UNLOCK-MODEL.md §1: toggle off → open; exempt unit → open; nearest
// preceding NON-EXEMPT unit gates via the Phase-3 passed-helper; no preceding non-exempt → open. Computed
// LIVE (no cached lock state) — the ordered-units query + passed-helper are mocked so only the rule runs.

vi.mock('@cio/db/queries/gating', () => ({
  getCourseSequentialUnlock: vi.fn(),
  getOrderedUnitsForCourse: vi.fn()
}));
vi.mock('@cio/db/queries/coursework', () => ({
  hasLearnerPassedUnit: vi.fn(),
  // pulled in by the guard module's import chain — stubbed so the module loads
  getSubmissionByFileKey: vi.fn(),
  isUnitUploadClosed: vi.fn()
}));

import { getCourseSequentialUnlock, getOrderedUnitsForCourse } from '@cio/db/queries/gating';
import { hasLearnerPassedUnit } from '@cio/db/queries/coursework';
import { isUnitUnlocked } from '@api/middlewares/guards';

const mToggle = vi.mocked(getCourseSequentialUnlock);
const mUnits = vi.mocked(getOrderedUnitsForCourse);
const mPassed = vi.mocked(hasLearnerPassedUnit);

const C = 'course-1';
const L1 = 'learner-1';
const L2 = 'learner-2';

// A course: u1(session) u2(session) u3(session), plus an exempt-heavy variant for transparency.
const CHAIN = [
  { lessonId: 'u1', unitType: 'session' },
  { lessonId: 'u2', unitType: 'session' },
  { lessonId: 'u3', unitType: 'session' }
];

beforeEach(() => {
  vi.clearAllMocks();
  mToggle.mockResolvedValue(true); // gated by default; individual tests flip
  mUnits.mockResolvedValue(CHAIN as never);
  mPassed.mockResolvedValue(false);
});

describe('isUnitUnlocked — truth table', () => {
  it('toggle OFF → every unit open, passed-helper never consulted', async () => {
    mToggle.mockResolvedValue(false);
    expect(await isUnitUnlocked(C, 'u2', L1)).toBe(true);
    expect(await isUnitUnlocked(C, 'u3', L1)).toBe(true);
    expect(mPassed).not.toHaveBeenCalled();
  });

  it('an EXEMPT unit is always open (anywhere in the chain), passed-helper never consulted for it', async () => {
    mUnits.mockResolvedValue([
      { lessonId: 'u1', unitType: 'session' },
      { lessonId: 'u2', unitType: 'induction' },
      { lessonId: 'u3', unitType: 'id-check' }
    ] as never);
    expect(await isUnitUnlocked(C, 'u2', L1)).toBe(true);
    expect(await isUnitUnlocked(C, 'u3', L1)).toBe(true);
    expect(mPassed).not.toHaveBeenCalled();
  });

  it('the FIRST gated unit (no preceding non-exempt) → open', async () => {
    // u1 is first; even preceded only by exempt units it is open.
    mUnits.mockResolvedValue([
      { lessonId: 'i0', unitType: 'induction' },
      { lessonId: 'u1', unitType: 'session' }
    ] as never);
    expect(await isUnitUnlocked(C, 'u1', L1)).toBe(true);
    expect(mPassed).not.toHaveBeenCalled();
  });

  it('a unit after an UNPASSED predecessor → locked', async () => {
    mPassed.mockResolvedValue(false);
    expect(await isUnitUnlocked(C, 'u2', L1)).toBe(false);
    expect(mPassed).toHaveBeenCalledWith(L1, 'u1');
  });

  it('UNLOCKS once the predecessor is passed', async () => {
    mPassed.mockResolvedValue(true);
    expect(await isUnitUnlocked(C, 'u2', L1)).toBe(true);
    expect(mPassed).toHaveBeenCalledWith(L1, 'u1');
  });

  it('EXEMPT units are transparent: unit 8 gates on unit 6 when unit 7 is exempt', async () => {
    mUnits.mockResolvedValue([
      { lessonId: 'u6', unitType: 'session' },
      { lessonId: 'u7', unitType: 'induction' }, // exempt — skipped
      { lessonId: 'u8', unitType: 'session' }
    ] as never);
    mPassed.mockResolvedValue(true);
    expect(await isUnitUnlocked(C, 'u8', L1)).toBe(true);
    expect(mPassed).toHaveBeenCalledWith(L1, 'u6'); // NOT u7
    expect(mPassed).not.toHaveBeenCalledWith(L1, 'u7');
  });

  it('a REFER on the predecessor (not a passing result) → still locked', async () => {
    mPassed.mockResolvedValue(false); // hasLearnerPassedUnit already encodes "latest marked result is passing"
    expect(await isUnitUnlocked(C, 'u3', L1)).toBe(false);
    expect(mPassed).toHaveBeenCalledWith(L1, 'u2');
  });

  it('two learners at different positions get INDEPENDENT answers', async () => {
    mPassed.mockImplementation(async (learnerId: string) => learnerId === L1); // L1 passed u1, L2 did not
    expect(await isUnitUnlocked(C, 'u2', L1)).toBe(true);
    expect(await isUnitUnlocked(C, 'u2', L2)).toBe(false);
  });

  it('computed LIVE — flipping the passed-helper flips unlock (no cached state)', async () => {
    mPassed.mockResolvedValue(false);
    expect(await isUnitUnlocked(C, 'u2', L1)).toBe(false);
    mPassed.mockResolvedValue(true);
    expect(await isUnitUnlocked(C, 'u2', L1)).toBe(true);
  });
});
