import { beforeEach, describe, expect, it, vi } from 'vitest';

// PearlLMS Phase 5 Step 2 — completion RULE + idempotent insert + backfill (TEST-FIRST, written before
// the implementation). The rule composes the Phase-3 passed-helper across the course's NON-EXEMPT units
// (docs/PROGRESS-MODEL.md §1). Exempt units (induction / id-check) are ignored in both the rule and the
// denominator. DB reads are mocked so only the decision logic runs; real ON-CONFLICT idempotency +
// transactionality are proven in the live harness (committed output in the step report).

vi.mock('@cio/db/queries/gating', () => ({ getOrderedUnitsForCourse: vi.fn() }));
vi.mock('@cio/db/queries/coursework', () => ({ hasLearnerPassedUnit: vi.fn() }));

import { getOrderedUnitsForCourse } from '@cio/db/queries/gating';
import { hasLearnerPassedUnit } from '@cio/db/queries/coursework';
import { isCourseComplete, insertCompletionIfAbsent, backfillCompletions } from '@cio/db/queries/completion';

const mUnits = vi.mocked(getOrderedUnitsForCourse);
const mPassed = vi.mocked(hasLearnerPassedUnit);

const L = 'learner-1';
const C = 'course-1';
const unit = (lessonId: string, unitType: string | null) => ({ lessonId, unitType, title: lessonId });

/** Drive hasLearnerPassedUnit off an explicit passed-set of lessonIds. */
function passedSet(...lessonIds: string[]) {
  const set = new Set(lessonIds);
  mPassed.mockImplementation(async (_learner: string, lessonId: string) => set.has(lessonId));
}

beforeEach(() => vi.clearAllMocks());

// ── Rule truth table ─────────────────────────────────────────────────────────────────────────────
describe('isCourseComplete — all non-exempt units passed', () => {
  it('all non-exempt units passed → complete', async () => {
    mUnits.mockResolvedValue([unit('s1', 'session'), unit('s2', 'session'), unit('s3', 'portfolio-review')]);
    passedSet('s1', 's2', 's3');
    expect(await isCourseComplete(L, C)).toBe(true);
  });

  it('one gated unit unpassed → NOT complete', async () => {
    mUnits.mockResolvedValue([unit('s1', 'session'), unit('s2', 'session'), unit('s3', 'portfolio-review')]);
    passedSet('s1', 's2'); // s3 not passed
    expect(await isCourseComplete(L, C)).toBe(false);
  });

  it('exempt units (induction / id-check) are IGNORED — not required, not in denominator', async () => {
    mUnits.mockResolvedValue([
      unit('ind', 'induction'), // exempt, never passed
      unit('idc', 'id-check'), // exempt, never passed
      unit('s1', 'session')
    ]);
    passedSet('s1'); // only the one non-exempt unit passed; exempts unpassed
    expect(await isCourseComplete(L, C)).toBe(true);
  });

  it('Refer on the latest version of a required unit → that unit not passed → NOT complete', async () => {
    mUnits.mockResolvedValue([unit('s1', 'session'), unit('s2', 'session')]);
    passedSet('s1'); // s2 latest-marked = REFER ⇒ hasLearnerPassedUnit false
    expect(await isCourseComplete(L, C)).toBe(false);
  });

  it('unlock-off course follows the SAME rule (the rule never reads sequential_unlock)', async () => {
    // The rule takes no toggle input — an unlock-off course with every non-exempt unit passed is complete.
    mUnits.mockResolvedValue([unit('a', null), unit('b', 'session')]); // null type = a normal gated unit
    passedSet('a', 'b');
    expect(await isCourseComplete(L, C)).toBe(true);
  });

  it('a course with ZERO non-exempt units is NOT completable (empty denominator)', async () => {
    mUnits.mockResolvedValue([unit('ind', 'induction'), unit('idc', 'id-check')]);
    passedSet(); // nothing passable
    expect(await isCourseComplete(L, C)).toBe(false);
  });

  it('an empty course is NOT complete', async () => {
    mUnits.mockResolvedValue([]);
    passedSet();
    expect(await isCourseComplete(L, C)).toBe(false);
  });
});

// ── Idempotent insert (ON CONFLICT branch logic; real constraint proven in the live harness) ──────
describe('insertCompletionIfAbsent — idempotent check-and-insert', () => {
  const NEW_ROW = { id: 'cc1', learnerId: L, courseId: C, completedAt: 't', createdAt: 't' };
  const EXISTING = { id: 'cc0', learnerId: L, courseId: C, completedAt: 't0', createdAt: 't0' };

  const stubClient = (returningRows: unknown[]) =>
    ({
      insert: () => ({
        values: () => ({ onConflictDoNothing: () => ({ returning: async () => returningRows }) })
      }),
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [EXISTING] }) }) })
    }) as never;

  it('no existing row → inserts and reports inserted:true', async () => {
    const r = await insertCompletionIfAbsent(stubClient([NEW_ROW]), { learnerId: L, courseId: C, completedAt: 't' });
    expect(r).toEqual({ inserted: true, row: NEW_ROW });
  });

  it('conflict (row already there) → inserted:false, returns the existing row (no duplicate)', async () => {
    const r = await insertCompletionIfAbsent(stubClient([]), { learnerId: L, courseId: C, completedAt: 't' });
    expect(r.inserted).toBe(false);
    expect(r.row).toEqual(EXISTING);
  });
});

// ── Backfill through the SAME rule code ────────────────────────────────────────────────────────
describe('backfillCompletions — inserts missing, skips existing + incomplete, reports counts', () => {
  it('walks enrolments and records only the qualifying, not-yet-recorded ones', async () => {
    const enrollments = [
      { learnerId: 'A', courseId: 'X' }, // complete + absent → newly recorded
      { learnerId: 'B', courseId: 'X' }, // complete + already recorded → skipped (already)
      { learnerId: 'D', courseId: 'X' } // incomplete → skipped (incomplete)
    ];
    const audited: string[] = [];
    const report = await backfillCompletions({
      listEnrollments: async () => enrollments,
      isComplete: async (l) => l !== 'D',
      completedAtFor: async () => '2026-01-01T00:00:00Z',
      insertIfAbsent: async ({ learnerId }) =>
        learnerId === 'A'
          ? {
              inserted: true,
              row: { id: `cc-${learnerId}`, learnerId, courseId: 'X', completedAt: 't', createdAt: 't' }
            }
          : { inserted: false, row: { id: 'cc-B', learnerId, courseId: 'X', completedAt: 't', createdAt: 't' } },
      onAudit: async (row) => {
        audited.push(row.id);
      }
    });

    expect(report.scanned).toBe(3);
    expect(report.newlyRecorded).toBe(1);
    expect(report.alreadyRecorded).toBe(1);
    expect(report.skippedIncomplete).toBe(1);
    expect(report.insertedIds).toEqual(['cc-A']);
    expect(audited).toEqual(['cc-A']); // audit fires ONLY for a genuine new insert
  });

  it('re-running with everything already recorded is a no-op (idempotent)', async () => {
    const report = await backfillCompletions({
      listEnrollments: async () => [{ learnerId: 'A', courseId: 'X' }],
      isComplete: async () => true,
      completedAtFor: async () => null,
      insertIfAbsent: async () => ({
        inserted: false,
        row: { id: 'cc-A', learnerId: 'A', courseId: 'X', completedAt: 't', createdAt: 't' }
      })
    });
    expect(report.newlyRecorded).toBe(0);
    expect(report.alreadyRecorded).toBe(1);
  });
});
