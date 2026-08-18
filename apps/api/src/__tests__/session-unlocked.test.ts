import { beforeEach, describe, expect, it, vi } from 'vitest';

// PearlLMS Phase 6 Step 2 — the session.unlocked derivation (docs/COMMS-MODEL.md §1). getUnitsUnlockedByPass
// composes the SAME Phase-4 chain walk (findGatePredecessorIndex) as isUnitUnlocked — no duplicate logic —
// to find exactly the non-exempt unit(s) a Pass newly opens. Toggle off → nothing; a Pass fires only for the
// units gated directly on the passed unit.

vi.mock('@cio/db/queries/gating', () => ({
  getCourseSequentialUnlock: vi.fn(),
  getOrderedUnitsForCourse: vi.fn()
}));

import { getCourseSequentialUnlock, getOrderedUnitsForCourse } from '@cio/db/queries/gating';
import { getUnitsUnlockedByPass } from '@api/services/gating/unlock';

const mToggle = vi.mocked(getCourseSequentialUnlock);
const mUnits = vi.mocked(getOrderedUnitsForCourse);

const COURSE = 'c1';
const unit = (lessonId: string, unitType: string | null, title: string) => ({ lessonId, unitType, title });
// iCQ-shaped: induction + id-check exempt, then S1 → S2 → S3 gated in order.
const UNITS = [
  unit('ind', 'induction', 'Induction'),
  unit('idc', 'id-check', 'ID check'),
  unit('s1', 'session', 'Session 1'),
  unit('s2', 'session', 'Session 2'),
  unit('s3', 'portfolio-review', 'Portfolio review')
];

beforeEach(() => {
  vi.clearAllMocks();
  mToggle.mockResolvedValue(true);
  mUnits.mockResolvedValue(UNITS as never);
});

describe('getUnitsUnlockedByPass', () => {
  it('passing S1 opens exactly S2 (the unit gated directly on S1)', async () => {
    const opened = await getUnitsUnlockedByPass(COURSE, 's1');
    expect(opened).toEqual([{ lessonId: 's2', title: 'Session 2' }]);
  });

  it('passing S2 opens exactly S3', async () => {
    const opened = await getUnitsUnlockedByPass(COURSE, 's2');
    expect(opened).toEqual([{ lessonId: 's3', title: 'Portfolio review' }]);
  });

  it('passing an EXEMPT unit opens the first gated session (S1 gates on the nearest non-exempt predecessor = none → but S1 has no gate; the unit gating on an exempt is transparent)', async () => {
    // idc is exempt; S1's gate predecessor is the nearest NON-exempt before it = none → S1 is first-gated (open
    // already). So passing an exempt unit opens nothing (no unit gates on an exempt unit).
    const opened = await getUnitsUnlockedByPass(COURSE, 'idc');
    expect(opened).toEqual([]);
  });

  it('passing the LAST unit opens nothing', async () => {
    expect(await getUnitsUnlockedByPass(COURSE, 's3')).toEqual([]);
  });

  it('toggle OFF → nothing was locked, so nothing is "newly opened"', async () => {
    mToggle.mockResolvedValue(false);
    expect(await getUnitsUnlockedByPass(COURSE, 's1')).toEqual([]);
  });

  it('a lesson not in the course → nothing', async () => {
    expect(await getUnitsUnlockedByPass(COURSE, 'nope')).toEqual([]);
  });

  it('exempt units in the chain are transparent: [ind, idc, s1, s2] — passing s1 still opens s2 (exempts skipped)', async () => {
    mUnits.mockResolvedValue([
      unit('ind', 'induction', 'Induction'),
      unit('s1', 'session', 'S1'),
      unit('idc', 'id-check', 'ID check'), // exempt sits between s1 and s2
      unit('s2', 'session', 'S2')
    ] as never);
    // s2's nearest non-exempt predecessor is s1 (idc skipped) → passing s1 opens s2.
    expect(await getUnitsUnlockedByPass(COURSE, 's1')).toEqual([{ lessonId: 's2', title: 'S2' }]);
  });
});
