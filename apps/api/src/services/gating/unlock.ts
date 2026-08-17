import type { Actor } from '@cio/db/actor';
import { getCourseSequentialUnlock, getOrderedUnitsForCourse } from '@cio/db/queries/gating';
import { hasLearnerPassedUnit } from '@cio/db/queries/coursework';
import { findGatePredecessorIndex, isExemptUnitType } from '@cio/utils/constants';
import { isRole } from '@cio/utils/auth';

// Per-unit lock state for a learner's course OUTLINE (PearlLMS Phase 4 Step 3). PRESENTATION only — the
// server content/material/upload guards remain the control; this just lets the outline show what's locked
// and why. Computed from the SAME rule as isUnitUnlocked (shared findGatePredecessorIndex + the Phase-3
// passed-helper), so there is no duplicate chain logic in the client. Staff + toggle-off courses → every
// unit unlocked, no hints.

export interface UnitLockState {
  unlocked: boolean;
  /** For a LOCKED unit: the title of the session that unlocks it (nearest preceding non-exempt). Else null. */
  lockedByTitle: string | null;
}
export type CourseUnlockMap = Record<string, UnitLockState>;

export async function getCourseUnlockMap(actor: Actor, courseId: string): Promise<CourseUnlockMap> {
  const units = await getOrderedUnitsForCourse(courseId);
  const map: CourseUnlockMap = {};

  // Staff are never gated; neither is a toggle-off course → every unit is open (no hints).
  const isStaff = actor.authenticated && isRole(actor, 'ADMIN', 'TUTOR', 'MANAGER');
  const gated = actor.authenticated && !isStaff && (await getCourseSequentialUnlock(courseId));
  if (!gated) {
    for (const u of units) map[u.lessonId] = { unlocked: true, lockedByTitle: null };
    return map;
  }

  const learnerId = actor.authenticated ? actor.userId : '';
  const passedCache = new Map<string, boolean>();
  const passed = async (lessonId: string): Promise<boolean> => {
    if (!passedCache.has(lessonId)) passedCache.set(lessonId, await hasLearnerPassedUnit(learnerId, lessonId));
    return passedCache.get(lessonId)!;
  };

  for (let i = 0; i < units.length; i++) {
    if (isExemptUnitType(units[i].unitType)) {
      map[units[i].lessonId] = { unlocked: true, lockedByTitle: null };
      continue;
    }
    const p = findGatePredecessorIndex(units, i);
    if (p === null) {
      map[units[i].lessonId] = { unlocked: true, lockedByTitle: null };
      continue;
    }
    const unlocked = await passed(units[p].lessonId);
    map[units[i].lessonId] = {
      unlocked,
      lockedByTitle: unlocked ? null : (units[p].title ?? 'the previous session')
    };
  }
  return map;
}
