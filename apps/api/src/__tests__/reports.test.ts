import { describe, expect, it } from 'vitest';
import { assembleReportRows } from '@cio/db/queries/reports';
import { computeProgress } from '@cio/db/queries/progress';

// PearlLMS Phase 5 Step 4 — the provider-wide report ASSEMBLY (docs/PROGRESS-MODEL.md §5). Proves:
// (a) numbers are identical to the shared computation (assembleReportRows defers to computeProgress);
// (b) PII-free at the serialisation level — each row is EXACTLY the allow-listed identity+progress keys,
//     with NO profile field (email/phone/address/DOB/etc.) anywhere in the payload.

const COURSE = 'course-1';
const unit = (lessonId: string, unitType: string | null, title: string) => ({ lessonId, unitType, title });
// iCQ-shaped: 2 exempt + 3 non-exempt.
const UNITS = [
  unit('ind', 'induction', 'Induction'),
  unit('idc', 'id-check', 'ID check'),
  unit('s1', 'session', 'Session 1'),
  unit('s2', 'session', 'Session 2'),
  unit('s3', 'portfolio-review', 'Portfolio review')
];

const ROW_KEYS = ['completed', 'completedAt', 'currentPosition', 'learnerId', 'name', 'passed', 'total'];

describe('assembleReportRows — numbers match the shared computation', () => {
  it('mid-chain + completed learners get the same numbers computeProgress would produce', () => {
    const learners = [
      { learnerId: 'L-mid', name: 'Mid Chain' },
      { learnerId: 'L-done', name: 'All Done' },
      { learnerId: 'L-fresh', name: 'Fresh Start' }
    ];
    const results = [
      { learnerId: 'L-mid', lessonId: 's1', result: 'PASS' },
      { learnerId: 'L-mid', lessonId: 's2', result: 'REFER' }, // not passing
      { learnerId: 'L-done', lessonId: 's1', result: 'PASS' },
      { learnerId: 'L-done', lessonId: 's2', result: 'PASS' },
      { learnerId: 'L-done', lessonId: 's3', result: 'PASS' }
    ];
    const completions = new Map<string, string>([['L-done', '2026-08-17T10:00:00Z']]);

    const rows = assembleReportRows(COURSE, UNITS, learners, results, completions);
    const byId = Object.fromEntries(rows.map((r) => [r.learnerId, r]));

    // Mid-chain: 1 of 3, on session 2 — identical to the learner-view computation.
    const midExpected = computeProgress(COURSE, UNITS, (l) => l === 's1', null);
    expect(byId['L-mid'].passed).toBe(midExpected.passed);
    expect(byId['L-mid'].total).toBe(midExpected.total);
    expect(byId['L-mid'].currentPosition).toEqual(midExpected.currentPosition);
    expect(byId['L-mid'].passed).toBe(1);
    expect(byId['L-mid'].total).toBe(3);
    expect(byId['L-mid'].currentPosition).toEqual({ lessonId: 's2', title: 'Session 2', index: 2 });

    // Completed: 3 of 3, no position, date shown.
    expect(byId['L-done'].completed).toBe(true);
    expect(byId['L-done'].completedAt).toBe('2026-08-17T10:00:00Z');
    expect(byId['L-done'].currentPosition).toBeNull();
    expect(byId['L-done'].passed).toBe(3);

    // Fresh: 0 of 3, on session 1, not completed.
    expect(byId['L-fresh'].passed).toBe(0);
    expect(byId['L-fresh'].completed).toBe(false);
    expect(byId['L-fresh'].currentPosition).toEqual({ lessonId: 's1', title: 'Session 1', index: 1 });
  });
});

describe('assembleReportRows — PII-free payload (serialisation level)', () => {
  it('every row has EXACTLY the allow-listed identity+progress keys, no profile fields', () => {
    const learners = [{ learnerId: 'L1', name: 'Alice Learner' }];
    const rows = assembleReportRows(COURSE, UNITS, learners, [], new Map());
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(ROW_KEYS);
    }
  });

  it('a fully-populated profile cannot leak — the assembler only ever receives {learnerId, name}', () => {
    // The assembler's learner input is structurally {learnerId, name}; even if a caller mistakenly spread a
    // profile object onto it, the output row is rebuilt field-by-field, so only allow-listed keys survive.
    const pollutedLearners = [
      {
        learnerId: 'L1',
        name: 'Alice Learner',
        // simulated profile PII that must NOT survive into the row
        email: 'alice@example.com',
        phone: '+441234567890',
        address: '1 Test St',
        dob: '1990-01-01',
        ni_number: 'QQ123456C',
        fullname: 'Alice PROFILE Fullname'
      } as unknown as { learnerId: string; name: string }
    ];
    const rows = assembleReportRows(COURSE, UNITS, pollutedLearners, [], new Map());
    const serialised = JSON.stringify(rows);
    for (const pii of ['alice@example.com', '+441234567890', '1 Test St', '1990-01-01', 'QQ123456C', 'PROFILE']) {
      expect(serialised).not.toContain(pii);
    }
    expect(Object.keys(rows[0]).sort()).toEqual(ROW_KEYS);
  });
});
