// Env feature flags read per call (so a restart-free test can flip them). Unset/empty => the default; "false", "0",
// "off", "no" disable; anything else enables.
function flag(raw: string | undefined, defaultOn: boolean): boolean {
  if (raw === undefined || raw.trim() === '') return defaultOn;

  return !['false', '0', 'off', 'no'].includes(raw.trim().toLowerCase());
}

/**
 * Cohort-goal reminder EMAILS (owner decision 11): OFF by default. The scan enqueues one email per learner per
 * reminder day, so enabling it needs an explicit go-ahead (COHORT_GOAL_REMINDER_EMAILS_ENABLED=true).
 */
export function isCohortGoalReminderEmailsEnabled(): boolean {
  return flag(process.env.COHORT_GOAL_REMINDER_EMAILS_ENABLED, false);
}
