import type { JobsOptions } from 'bullmq';

import { JOB_NAMES, QUEUE_NAMES } from '../queues/names';
import { QUEUE_DEFAULTS } from '../queues/defaults';
import { getQueue } from '../queues/factories';
import type { TNotifyCourseExercisePayload, TNotifyCourseSessionUpdatePayload } from '../payloads/notifications';

/** A repeat "Notify students" click inside this window is the same nudge (double-click / retry / spam). */
export const NOTIFY_EXERCISE_DEDUPE_WINDOW_MS = 15 * 60 * 1000;

/**
 * Stable job id for a notify-exercise nudge: course + exercise + the 15-minute bucket the click falls in.
 * BullMQ ignores an add() whose jobId already exists and hands back the EXISTING job, so a duplicate click
 * returns the same id (the dashboard poll keeps working) instead of emailing every student again.
 */
export function notifyCourseExerciseJobId(courseId: string, exerciseId: string, nowMs: number = Date.now()): string {
  return `notify-exercise-${courseId}-${exerciseId}-${Math.floor(nowMs / NOTIFY_EXERCISE_DEDUPE_WINDOW_MS)}`;
}

/**
 * Enqueue a `notifications:notify-course-exercise` job. Returns the BullMQ
 * job id so the dashboard can poll its status. Clicks for the same exercise
 * within the same 15-minute bucket collapse onto one job (see
 * notifyCourseExerciseJobId); a later click is a fresh nudge.
 */
export async function enqueueNotifyCourseExercise(
  payload: TNotifyCourseExercisePayload & { exerciseId?: string },
  options: JobsOptions = {}
): Promise<string | undefined> {
  const { exerciseId, ...jobPayload } = payload;
  const job = await getQueue(QUEUE_NAMES.notifications).add(JOB_NAMES.notifications.notifyCourseExercise, jobPayload, {
    ...QUEUE_DEFAULTS[QUEUE_NAMES.notifications],
    ...(exerciseId ? { jobId: notifyCourseExerciseJobId(payload.courseId, exerciseId) } : {}),
    ...options
  });

  return job.id;
}

/** Enqueue a one-off run of the session-reminder scan (manual trigger / on-demand). */
export async function enqueueSessionReminderScan(options: JobsOptions = {}): Promise<string | undefined> {
  const job = await getQueue(QUEUE_NAMES.notifications).add(
    JOB_NAMES.notifications.sessionReminderScan,
    {},
    { ...QUEUE_DEFAULTS[QUEUE_NAMES.notifications], ...options }
  );

  return job.id;
}

/** Enqueue a "session updated" notification that emails members an updated calendar invite. */
export async function enqueueNotifyCourseSessionUpdate(
  payload: TNotifyCourseSessionUpdatePayload,
  options: JobsOptions = {}
): Promise<string | undefined> {
  const job = await getQueue(QUEUE_NAMES.notifications).add(
    JOB_NAMES.notifications.notifyCourseSessionUpdate,
    payload,
    {
      ...QUEUE_DEFAULTS[QUEUE_NAMES.notifications],
      ...options
    }
  );

  return job.id;
}
