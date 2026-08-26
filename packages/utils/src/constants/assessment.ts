/**
 * Assessment/submission config (PearlLMS Phase 8). Single CONFIG source — the Drizzle jsonb `$type`,
 * the Zod validators, the authoring UI, the learner/tutor UI, and the gating change all import from
 * here; no hardcoded 'workbook'/'draft'/'verdict' literals live in queries or components.
 *
 * A lesson material (`lesson.documents[]`) carries an optional `kind`. Absent or 'resource' = a plain
 * read-only material (existing behaviour). The three ASSESSMENT kinds turn a file into a brief the
 * learner downloads, answers, and uploads a coursework submission against (keyed by the document `key`).
 */
export const MATERIAL_KINDS = ['resource', 'workbook', 'casestudy', 'assignment'] as const;
export type MaterialKind = (typeof MATERIAL_KINDS)[number];

/** The kinds that REQUIRE a learner submission + tutor grading (everything except plain resources). */
export const ASSESSMENT_KINDS = ['workbook', 'casestudy', 'assignment'] as const;
export type AssessmentKind = (typeof ASSESSMENT_KINDS)[number];

/** Human-readable labels for the authoring + learner/tutor UI. */
export const MATERIAL_KIND_LABELS: Record<MaterialKind, string> = {
  resource: 'Resource',
  workbook: 'Workbook',
  casestudy: 'Case study',
  assignment: 'Assignment'
};

/** Runtime membership check against the configured material-kind list. */
export function isMaterialKind(value: unknown): value is MaterialKind {
  return typeof value === 'string' && (MATERIAL_KINDS as readonly string[]).includes(value);
}

/**
 * Does this material kind require a submission (i.e. is it an assessment, not a plain resource)?
 * Absent/null/'resource' → false. The single place this distinction is made — the learner UI, the
 * submit guard, and the progress/gating aggregation all read this, never a literal.
 */
export function isAssessmentKind(value: unknown): value is AssessmentKind {
  return typeof value === 'string' && (ASSESSMENT_KINDS as readonly string[]).includes(value);
}

/**
 * Submission type. 'final' is graded PASS/REFER and gates the unit; 'draft' is feedback-only and NEVER
 * gates. Stored in `coursework_submission.submission_type` (plain varchar; default 'final').
 */
export const SUBMISSION_TYPES = ['final', 'draft'] as const;
export type SubmissionType = (typeof SUBMISSION_TYPES)[number];

export function isSubmissionType(value: unknown): value is SubmissionType {
  return typeof value === 'string' && (SUBMISSION_TYPES as readonly string[]).includes(value);
}

/**
 * Result kind. 'verdict' carries a RESULT_VALUES value (PASS/REFER) on a FINAL submission and gates the
 * unit; 'draft' carries feedback only (result = null) on a DRAFT submission and never gates. Stored in
 * `coursework_result.kind` (plain varchar; default 'verdict').
 */
export const RESULT_KINDS = ['verdict', 'draft'] as const;
export type ResultKind = (typeof RESULT_KINDS)[number];

export function isResultKind(value: unknown): value is ResultKind {
  return typeof value === 'string' && (RESULT_KINDS as readonly string[]).includes(value);
}

/**
 * Marking SLA — hours after a FINAL submission within which a tutor is expected to grade it. Drives the
 * tutor "Overdue (ungraded)" queue only (informational; it never blocks anything). Config-driven so it
 * can be tuned per-deployment without a code change; default 72h (owner-confirmed).
 */
export const DEFAULT_MARKING_SLA_HOURS = 72;

export function resolveMarkingSlaHours(env?: { MARKING_SLA_HOURS?: string }): number {
  const raw = env?.MARKING_SLA_HOURS;
  if (raw === undefined || raw === '') return DEFAULT_MARKING_SLA_HOURS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MARKING_SLA_HOURS;
}

/** Days-ahead window for the tutor "Due soon" queue + learner "Upcoming due dates" surface. */
export const DUE_SOON_WINDOW_DAYS = 3;
