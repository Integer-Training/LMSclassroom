import { runCohortGoalEvaluationSweep, runCohortGoalReminderScan } from '@api/services/cohort/goal';

import { Hono } from '@api/utils/hono';
import { apiKeyMiddleware } from '@api/middlewares/api-key';
import { enqueueComplianceExpiryScan, enqueueComplianceReminderScan, enqueueSessionReminderScan } from '@cio/jobs';
import { handleError } from '@api/utils/errors';
import { isCohortGoalReminderEmailsEnabled } from '@api/utils/feature-flags';
import { enqueueFailureToAppError } from '@api/utils/queue-errors';

export const internalComplianceRouter = new Hono()
  .post('/send-session-reminders', apiKeyMiddleware, async (c) => {
    try {
      const jobId = await enqueueSessionReminderScan();

      return c.json({ success: true, data: { jobId: jobId ?? null } }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to enqueue session reminder scan');
    }
  })
  /**
   * POST /internal/compliance/check-expiry
   * Thin enqueue: the scan itself (chunked, set-based, single-run guarded) runs in the jobs worker. It is also on a
   * daily schedule there; this endpoint is the manual "run now".
   */
  .post('/check-expiry', apiKeyMiddleware, async (c) => {
    try {
      const jobId = await enqueueComplianceExpiryScan().catch((error) => {
        throw enqueueFailureToAppError(error, 'Failed to enqueue compliance expiry check');
      });

      return c.json({ success: true, data: { jobId: jobId ?? null } }, 202);
    } catch (error) {
      return handleError(c, error, 'Failed to enqueue compliance expiry check');
    }
  })
  /** POST /internal/compliance/send-reminders — thin enqueue of the reminder/status scan (runs in the jobs worker). */
  .post('/send-reminders', apiKeyMiddleware, async (c) => {
    try {
      const jobId = await enqueueComplianceReminderScan().catch((error) => {
        throw enqueueFailureToAppError(error, 'Failed to enqueue compliance reminder scan');
      });

      return c.json({ success: true, data: { jobId: jobId ?? null } }, 202);
    } catch (error) {
      return handleError(c, error, 'Failed to enqueue compliance reminder scan');
    }
  })
  /**
   * POST /internal/compliance/evaluate-cohort-goals
   * Daily sweep: re-evaluate every active cohort goal and refresh per-learner
   * `cohort_goal_assignment` rows.
   */
  .post('/evaluate-cohort-goals', apiKeyMiddleware, async (c) => {
    try {
      const data = await runCohortGoalEvaluationSweep();

      return c.json({ success: true, data }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to run cohort goal evaluation sweep');
    }
  })
  /**
   * POST /internal/compliance/send-cohort-goal-reminders
   * Sends learner reminder emails for upcoming/overdue cohort goals using
   * each goal's `reminderDaysBefore` cadence. OFF unless COHORT_GOAL_REMINDER_EMAILS_ENABLED=true (owner decision 11).
   */
  .post('/send-cohort-goal-reminders', apiKeyMiddleware, async (c) => {
    try {
      if (!isCohortGoalReminderEmailsEnabled()) {
        return c.json({ success: true, data: { skipped: 'COHORT_GOAL_REMINDER_EMAILS_ENABLED is off' } }, 200);
      }

      const data = await runCohortGoalReminderScan();

      return c.json({ success: true, data }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to run cohort goal reminder scan');
    }
  });
