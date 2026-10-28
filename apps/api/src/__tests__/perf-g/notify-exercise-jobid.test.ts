import { beforeEach, describe, expect, it, vi } from 'vitest';

// Phase G (notify-exercise-spam) — clicks for the same exercise inside one 15-minute bucket collapse onto one
// BullMQ job (BullMQ ignores an add() with an existing jobId and returns that job), so the dashboard poll keeps
// working and students are not emailed repeatedly. A different exercise or the next bucket is a fresh nudge.

const { add } = vi.hoisted(() => ({
  add: vi.fn(async (_name: string, _data: unknown, opts: { jobId?: string }) => ({ id: opts.jobId ?? 'auto-1' }))
}));
const { getJob } = vi.hoisted(() => ({ getJob: vi.fn(async (_id: string): Promise<unknown> => undefined) }));
vi.mock('../../../../../packages/jobs/src/queues/factories', () => ({ getQueue: () => ({ add, getJob }) }));

import {
  NOTIFY_EXERCISE_DEDUPE_WINDOW_MS,
  enqueueNotifyCourseExercise,
  notifyCourseExerciseJobId
} from '../../../../../packages/jobs/src/enqueue/notifications';

const payload = {
  courseId: 'c1',
  exerciseTitle: 'Quiz',
  courseName: 'Course',
  orgName: 'Org',
  organizationId: 'o1',
  fromName: 'Org',
  quizUrl: 'https://x.test/q'
};

beforeEach(() => {
  add.mockClear();
  getJob.mockReset();
  getJob.mockResolvedValue(undefined);
});

describe('notifyCourseExerciseJobId', () => {
  const t0 = 1_800_000_000_000 - (1_800_000_000_000 % NOTIFY_EXERCISE_DEDUPE_WINDOW_MS); // a bucket boundary

  it('is stable inside a 15-minute bucket', () => {
    const a = notifyCourseExerciseJobId('c1', 'e1', t0);
    expect(notifyCourseExerciseJobId('c1', 'e1', t0 + NOTIFY_EXERCISE_DEDUPE_WINDOW_MS - 1)).toBe(a);
  });

  it('changes at the next bucket, for another exercise and for another course', () => {
    const a = notifyCourseExerciseJobId('c1', 'e1', t0);
    expect(notifyCourseExerciseJobId('c1', 'e1', t0 + NOTIFY_EXERCISE_DEDUPE_WINDOW_MS)).not.toBe(a);
    expect(notifyCourseExerciseJobId('c1', 'e2', t0)).not.toBe(a);
    expect(notifyCourseExerciseJobId('c2', 'e1', t0)).not.toBe(a);
  });

  it('contains no colon (BullMQ rejects custom ids with one)', () => {
    expect(notifyCourseExerciseJobId('c1', 'e1', t0)).not.toContain(':');
  });
});

describe('enqueueNotifyCourseExercise', () => {
  it('adds with the bucketed jobId and does not leak exerciseId into the job payload', async () => {
    const id = await enqueueNotifyCourseExercise({ ...payload, exerciseId: 'e1' });
    expect(id).toBe(add.mock.calls[0]![2].jobId);
    expect(add.mock.calls[0]![2].jobId).toMatch(/^notify-exercise-c1-e1-\d+$/);
    expect(add.mock.calls[0]![1]).toEqual(payload);
  });

  it('two immediate clicks use the same jobId (the second returns the existing job id)', async () => {
    const a = await enqueueNotifyCourseExercise({ ...payload, exerciseId: 'e1' });
    const b = await enqueueNotifyCourseExercise({ ...payload, exerciseId: 'e1' });
    expect(a).toBe(b);
  });

  it('without an exerciseId the old behaviour (no stable jobId) is kept', async () => {
    await enqueueNotifyCourseExercise(payload);
    expect(add.mock.calls[0]![2].jobId).toBeUndefined();
    expect(getJob).not.toHaveBeenCalled();
  });

  it('removes a FAILED job with the same id before adding so a retry click is not swallowed', async () => {
    const remove = vi.fn(async () => undefined);
    getJob.mockResolvedValue({ getState: async () => 'failed', remove });
    await enqueueNotifyCourseExercise({ ...payload, exerciseId: 'e1' });
    expect(getJob).toHaveBeenCalledWith(add.mock.calls[0]![2].jobId);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledTimes(1);
  });

  it.each(['completed', 'waiting', 'active', 'delayed'])('keeps a %s job (still dedupes)', async (state) => {
    const remove = vi.fn(async () => undefined);
    getJob.mockResolvedValue({ getState: async () => state, remove });
    await enqueueNotifyCourseExercise({ ...payload, exerciseId: 'e1' });
    expect(remove).not.toHaveBeenCalled();
  });

  it('still enqueues when the failed-job cleanup throws', async () => {
    getJob.mockResolvedValue({
      getState: async () => 'failed',
      remove: async () => {
        throw new Error('boom');
      }
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await enqueueNotifyCourseExercise({ ...payload, exerciseId: 'e1' });
    expect(add).toHaveBeenCalledTimes(1);
    errSpy.mockRestore();
  });
});
