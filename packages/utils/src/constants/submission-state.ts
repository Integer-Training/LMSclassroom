import { RESULT_LABELS, type ResultValue } from './result';

/**
 * The SINGLE place the caseload/review status vocabulary is read from (PearlLMS Phase 3 Step 4). A
 * unit's review state is derived from its LATEST submission's result: no result yet → awaiting marking;
 * otherwise the configured result label (Pass / Refer). Step 5 records results — this function starts
 * returning those states with no change at the call sites, so the caseload extends without rework.
 */
export type CaseloadStateKey = 'awaiting_marking' | ResultValue;

export const AWAITING_MARKING_KEY: CaseloadStateKey = 'awaiting_marking';
export const AWAITING_MARKING_LABEL = 'Awaiting marking';

export interface CaseloadState {
  key: CaseloadStateKey;
  label: string;
  /** True only while the latest submission has no result — drives the "awaiting marking" queue. */
  awaitingMarking: boolean;
}

/** Derive a unit's review state from the latest submission's result value (null/unknown → awaiting). */
export function deriveCaseloadState(latestResult: string | null | undefined): CaseloadState {
  if (latestResult && latestResult in RESULT_LABELS) {
    const key = latestResult as ResultValue;
    return { key, label: RESULT_LABELS[key], awaitingMarking: false };
  }
  return { key: AWAITING_MARKING_KEY, label: AWAITING_MARKING_LABEL, awaitingMarking: true };
}
