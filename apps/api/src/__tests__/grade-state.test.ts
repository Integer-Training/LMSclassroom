import { describe, expect, it } from 'vitest';
import { computeState, type StateSubmission } from '../services/caseload/grade-state';

// Newest-first lists, versions shared between drafts and finals (as recordResult / the learner upload sequence them).
const sub = (
  id: string,
  submissionType: 'draft' | 'final',
  version: number,
  mark: 'none' | 'PASS' | 'REFER' | 'feedback' = 'none'
): StateSubmission => ({
  submissionId: id,
  submissionType,
  version,
  resultKind: mark === 'none' ? null : mark === 'feedback' ? 'draft' : 'verdict',
  result: mark === 'PASS' || mark === 'REFER' ? mark : null
});

describe('computeState', () => {
  it('no submissions -> not_submitted, no target', () => {
    expect(computeState([])).toEqual({ state: 'not_submitted', gradeTargetId: null });
  });

  it('unmarked final -> awaiting_marking, target = the final', () => {
    expect(computeState([sub('f1', 'final', 1)])).toEqual({ state: 'awaiting_marking', gradeTargetId: 'f1' });
  });

  it('referred final then a NEW unmarked draft -> target = the draft, shown as draft (not plain referred)', () => {
    const r = computeState([sub('d2', 'draft', 2), sub('f1', 'final', 1, 'REFER')]);
    expect(r).toEqual({ state: 'draft', gradeTargetId: 'd2' });
  });

  it('referred final then a newer draft that already has feedback -> draft_feedback (matches the learner board), no target', () => {
    const r = computeState([sub('d2', 'draft', 2, 'feedback'), sub('f1', 'final', 1, 'REFER')]);
    expect(r).toEqual({ state: 'draft_feedback', gradeTargetId: null });
  });

  it('draft older than the referred final is ignored', () => {
    const r = computeState([sub('f2', 'final', 2, 'REFER'), sub('d1', 'draft', 1)]);
    expect(r).toEqual({ state: 'referred', gradeTargetId: null });
  });

  it('unmarked final + unmarked draft -> the final takes priority', () => {
    const r = computeState([sub('d3', 'draft', 3), sub('f2', 'final', 2), sub('f1', 'final', 1, 'REFER')]);
    expect(r).toEqual({ state: 'awaiting_marking', gradeTargetId: 'f2' });
    const r2 = computeState([sub('f3', 'final', 3), sub('d2', 'draft', 2)]);
    expect(r2).toEqual({ state: 'awaiting_marking', gradeTargetId: 'f3' });
  });

  it('only drafts: marked latest draft -> draft_feedback, no target', () => {
    expect(computeState([sub('d1', 'draft', 1, 'feedback')])).toEqual({ state: 'draft_feedback', gradeTargetId: null });
  });

  it('only drafts: unmarked latest draft -> draft, target = the latest draft', () => {
    expect(computeState([sub('d2', 'draft', 2), sub('d1', 'draft', 1, 'feedback')])).toEqual({
      state: 'draft',
      gradeTargetId: 'd2'
    });
  });

  it('passed final, nothing newer -> passed, no target', () => {
    expect(computeState([sub('f1', 'final', 1, 'PASS')])).toEqual({ state: 'passed', gradeTargetId: null });
  });

  it('passed final then a later unmarked draft (should not happen) -> stays passed, NO grade target (Pass is terminal)', () => {
    expect(computeState([sub('d2', 'draft', 2), sub('f1', 'final', 1, 'PASS')])).toEqual({
      state: 'passed',
      gradeTargetId: null
    });
  });

  it('passed final then a later MARKED draft -> passed, no target', () => {
    expect(computeState([sub('d2', 'draft', 2, 'feedback'), sub('f1', 'final', 1, 'PASS')])).toEqual({
      state: 'passed',
      gradeTargetId: null
    });
  });
});
