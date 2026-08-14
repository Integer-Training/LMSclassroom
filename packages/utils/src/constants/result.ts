/**
 * Allowed coursework RESULT values (PearlLMS Phase 3). This is the single CONFIG source — the Drizzle
 * column (`coursework_result.result`), the Zod validator, notification `statusText`, and Phase-4
 * gating all import from here; no hardcoded 'PASS'/'REFER' literals live in queries or components.
 *
 * The DB column is a plain varchar (allowed set stays in config, not a Postgres enum requiring a
 * migration to extend). A `result` is the tutor's OFF-platform verdict — the platform records it, it
 * does not compute it. A REFER means the learner must resubmit (new version); a PASS is terminal.
 */
export const RESULT_VALUES = ['PASS', 'REFER'] as const;

export type ResultValue = (typeof RESULT_VALUES)[number];

/** Human-readable labels for the tutor/learner UI + email statusText. */
export const RESULT_LABELS: Record<ResultValue, string> = {
  PASS: 'Pass',
  REFER: 'Refer'
};

/** The terminal (unit-passed) result — Phase-4 gating reads this. */
export const PASS_RESULT: ResultValue = 'PASS';

/** Runtime membership check against the configured list. */
export function isAllowedResult(value: unknown): value is ResultValue {
  return typeof value === 'string' && (RESULT_VALUES as readonly string[]).includes(value);
}
