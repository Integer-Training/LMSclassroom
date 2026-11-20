import { isPassingResult } from '@cio/utils/constants';

// PearlLMS — pure per-assessment grading state for the tutor submissions grid (kept free of DB/env imports so it is
// unit-testable). Mirrors marking.ts recordResult: drafts and finals share ONE version sequence per (learner, lesson,
// assessmentKey); only the latest version OF THE SAME TYPE is markable; one result per version; a draft gets
// feedback only (resultKind 'draft'), a final gets a verdict (resultKind 'verdict').

export type RowState = 'not_submitted' | 'draft' | 'draft_feedback' | 'awaiting_marking' | 'referred' | 'passed';

/** The minimal submission fields the state needs (GridSubmission and the lean status rows both satisfy it). */
export interface StateSubmission {
  submissionId: string;
  submissionType: string;
  version: number;
  resultKind: string | null;
  result: string | null;
}

/**
 * Per-assessment state from a learner's submissions for it (NEWEST FIRST). Mirrors the learner assignments board so
 * tutor + learner see the same status. Also returns the submission id the tutor can grade now.
 *
 * gradeTargetId is the latest UNMARKED markable version:
 *  1. the latest FINAL if it has no verdict yet (it needs a Pass/Refer — takes priority over any draft);
 *  2. otherwise the latest DRAFT if it has no feedback yet AND is newer than the latest (marked) final, or there is no final
 *     (e.g. the learner uploaded a draft after a Refer — shown as 'draft', not plain 'referred');
 *  3. otherwise null (everything already marked → the grid disables "Grade", no no-re-mark 409).
 */
export function computeState<T extends StateSubmission>(subs: T[]): { state: RowState; gradeTargetId: string | null } {
  if (subs.length === 0) return { state: 'not_submitted', gradeTargetId: null };
  const latestFinal = subs.find((s) => s.submissionType === 'final') ?? null;
  const latestDraft = subs.find((s) => s.submissionType === 'draft') ?? null;

  const finalHasVerdict = !!latestFinal && latestFinal.resultKind === 'verdict' && !!latestFinal.result;
  if (latestFinal && !finalHasVerdict) {
    return { state: 'awaiting_marking', gradeTargetId: latestFinal.submissionId }; // unmarked final → grade this
  }

  // A draft only matters when it is newer than the latest final (versions are one shared sequence).
  const draftIsCurrent = !!latestDraft && (!latestFinal || latestDraft.version > latestFinal.version);
  const draftUnmarked = !!latestDraft && latestDraft.resultKind !== 'draft';

  if (latestFinal) {
    // A Pass is terminal: uploads close, nothing more to grade (no Grade button even if a stray draft exists).
    if (isPassingResult(latestFinal.result)) return { state: 'passed', gradeTargetId: null };
    // Referred. A draft uploaded AFTER the Refer is the learner's current work — same rule as the learner board
    // (services/lms/assignments.ts computeItemState): unmarked → 'draft' (grade it), feedback given → 'draft_feedback'.
    if (latestDraft && draftIsCurrent) {
      return draftUnmarked
        ? { state: 'draft', gradeTargetId: latestDraft.submissionId }
        : { state: 'draft_feedback', gradeTargetId: null };
    }
    return { state: 'referred', gradeTargetId: null };
  }

  // Drafts only.
  if (latestDraft && latestDraft.resultKind === 'draft') {
    return { state: 'draft_feedback', gradeTargetId: null };
  }
  return { state: 'draft', gradeTargetId: latestDraft?.submissionId ?? subs[0].submissionId };
}
