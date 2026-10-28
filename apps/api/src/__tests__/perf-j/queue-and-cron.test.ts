import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Phase J (redis-down-api-hang, cron-scans-in-request) — the BullMQ producer connection fails fast instead of
// hanging when Redis is down, enqueue failures surface as a retryable 503 "queue unavailable", and the compliance
// "cron" endpoints are thin enqueue endpoints (the scan itself runs in the jobs worker). Cohort-goal reminder
// EMAILS stay off behind a flag.

vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
  process.env.PRIVATE_DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';
});

const jobs = vi.hoisted(() => ({
  enqueueComplianceExpiryScan: vi.fn(),
  enqueueComplianceReminderScan: vi.fn(),
  enqueueSessionReminderScan: vi.fn()
}));
vi.mock('@cio/jobs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@cio/jobs')>();
  return { ...actual, ...jobs };
});
vi.mock('@api/middlewares/api-key', () => ({
  apiKeyMiddleware: async (_c: unknown, next: () => Promise<void>) => next()
}));
const cohort = vi.hoisted(() => ({
  runCohortGoalEvaluationSweep: vi.fn(async () => ({ goalsEvaluated: 0, assignmentsEvaluated: 0 })),
  runCohortGoalReminderScan: vi.fn(async () => ({ scanned: 3, remindersEnqueued: 3 }))
}));
vi.mock('@api/services/cohort/goal', () => cohort);

import { Hono } from 'hono';
import {
  PRODUCER_CONNECTION_OPTIONS,
  QueueUnavailableError,
  RedisNotConfiguredError,
  closeSharedRedisConnection,
  configureProducerFailFast,
  ensureProducerReady,
  isQueueUnavailableError
} from '@cio/jobs';
import { internalComplianceRouter } from '@api/routes/internal/compliance';
import { enqueueFailureToAppError } from '@api/utils/queue-errors';
import { handleError } from '@api/utils/errors';

describe('producer connection options', () => {
  it('fails fast: no offline queue, one retry per request, 3 s connect timeout', () => {
    expect(PRODUCER_CONNECTION_OPTIONS).toMatchObject({
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 3_000
    });
  });
});

describe('isQueueUnavailableError', () => {
  it('recognises Redis-down failures from the fail-fast producer', () => {
    expect(isQueueUnavailableError(new Error("Stream isn't writeable and enableOfflineQueue options is false"))).toBe(
      true
    );
    expect(isQueueUnavailableError(new Error('Connection is closed.'))).toBe(true);
    expect(isQueueUnavailableError(Object.assign(new Error('x'), { name: 'MaxRetriesPerRequestError' }))).toBe(true);
    expect(isQueueUnavailableError(new QueueUnavailableError('redis reconnecting'))).toBe(true);
    expect(isQueueUnavailableError(new RedisNotConfiguredError())).toBe(true);
  });

  it('does not mistake ordinary failures for an outage', () => {
    expect(isQueueUnavailableError(new Error('Missing key jobId'))).toBe(false);
    expect(isQueueUnavailableError(undefined)).toBe(false);
  });
});

describe('enqueueFailureToAppError', () => {
  it('maps an outage to a 503 QUEUE_UNAVAILABLE and anything else to a 500', () => {
    const outage = enqueueFailureToAppError(new Error('Connection is closed.'), 'fallback');
    expect(outage.statusCode).toBe(503);
    expect(outage.code).toBe('QUEUE_UNAVAILABLE');

    const other = enqueueFailureToAppError(new Error('bad payload'), 'fallback');
    expect(other.statusCode).toBe(500);
  });
});

describe('cold start with Redis down', () => {
  afterAll(async () => {
    vi.unstubAllEnvs();
    await closeSharedRedisConnection();
  });

  it('ensureProducerReady rejects quickly (bounded by connectTimeout) instead of hanging forever', async () => {
    vi.stubEnv('REDIS_URL', 'redis://127.0.0.1:1');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const started = Date.now();

    await expect(ensureProducerReady()).rejects.toBeInstanceOf(QueueUnavailableError);
    expect(Date.now() - started).toBeLessThan(5_000);

    // Once the connection is known to be reconnecting, the next enqueue is rejected immediately.
    const second = Date.now();
    await expect(ensureProducerReady()).rejects.toBeInstanceOf(QueueUnavailableError);
    expect(Date.now() - second).toBeLessThan(500);
  }, 15_000);

  it('the fail-fast mode cannot be flipped after the shared connection exists', () => {
    expect(() => configureProducerFailFast(false)).toThrow(/before the shared Redis connection/);
  });
});

describe('/internal/compliance thin enqueue endpoints', () => {
  const app = new Hono();
  app.route('/internal/compliance', internalComplianceRouter);
  app.onError((err, c) => handleError(c, err, 'failed'));

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('check-expiry enqueues the scan and answers 202 with the job id (no scan in the request)', async () => {
    jobs.enqueueComplianceExpiryScan.mockResolvedValue('compliance-expiry-scan-1');

    const res = await app.request('/internal/compliance/check-expiry', { method: 'POST' });

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ success: true, data: { jobId: 'compliance-expiry-scan-1' } });
    expect(jobs.enqueueComplianceExpiryScan).toHaveBeenCalledTimes(1);
  });

  it('send-reminders enqueues the reminder scan', async () => {
    jobs.enqueueComplianceReminderScan.mockResolvedValue('compliance-reminder-scan-1');

    const res = await app.request('/internal/compliance/send-reminders', { method: 'POST' });

    expect(res.status).toBe(202);
    expect(jobs.enqueueComplianceReminderScan).toHaveBeenCalledTimes(1);
  });

  it('answers 503 when the queue is unreachable', async () => {
    jobs.enqueueComplianceExpiryScan.mockRejectedValue(
      new Error("Stream isn't writeable and enableOfflineQueue options is false")
    );

    const res = await app.request('/internal/compliance/check-expiry', { method: 'POST' });
    const body = (await res.json()) as { code: string };

    expect(res.status).toBe(503);
    expect(body.code).toBe('QUEUE_UNAVAILABLE');
  });

  it('cohort-goal reminder EMAILS are off by default (the scan is not run)', async () => {
    const res = await app.request('/internal/compliance/send-cohort-goal-reminders', { method: 'POST' });

    expect(res.status).toBe(200);
    expect(cohort.runCohortGoalReminderScan).not.toHaveBeenCalled();
  });

  it('cohort-goal reminder emails run only when COHORT_GOAL_REMINDER_EMAILS_ENABLED is turned on', async () => {
    vi.stubEnv('COHORT_GOAL_REMINDER_EMAILS_ENABLED', 'true');

    const res = await app.request('/internal/compliance/send-cohort-goal-reminders', { method: 'POST' });

    expect(res.status).toBe(200);
    expect(cohort.runCohortGoalReminderScan).toHaveBeenCalledTimes(1);
  });
});
