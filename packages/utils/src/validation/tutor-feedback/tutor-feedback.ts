import * as z from 'zod';

/**
 * PearlLMS — periodic learner→tutor feedback (the "every-N-units" popup, Feature 2).
 *
 * Shape-only validation for the learner's submission, plus the single source of truth for the milestone
 * cadence. The learner is prompted the first time at FIRST_MILESTONE passed units and every INTERVAL units
 * after that (2, 7, 12, 17, …). The server ALWAYS recomputes the milestone from the learner's real passed-
 * units count and stores that — a client-sent `milestone` is advisory and never trusted.
 */

export const FIRST_MILESTONE = 2;
export const MILESTONE_INTERVAL = 5;

/**
 * The milestone a learner is currently at, from their total passed units across all courses, or `null`
 * when they have not yet reached the first one. 0/1 → null, 2..6 → 2, 7..11 → 7, 12..16 → 12, …
 */
export function currentTutorFeedbackMilestone(passedUnits: number): number | null {
  if (!Number.isFinite(passedUnits) || passedUnits < FIRST_MILESTONE) return null;
  return FIRST_MILESTONE + MILESTONE_INTERVAL * Math.floor((passedUnits - FIRST_MILESTONE) / MILESTONE_INTERVAL);
}

const ZRating = z.number().int().min(1).max(5);

/** One learner feedback submission. Only the overall rating is required. */
export const ZTutorFeedbackSubmit = z.object({
  overallRating: ZRating,
  communicationRating: ZRating.optional(),
  helpfulnessRating: ZRating.optional(),
  knowledgeRating: ZRating.optional(),
  comment: z.string().trim().max(2000).optional(),
  // Advisory only — the server recomputes the milestone from real progress and stores THAT.
  milestone: z.number().int().positive().optional()
});

export type TutorFeedbackSubmitInput = z.infer<typeof ZTutorFeedbackSubmit>;
