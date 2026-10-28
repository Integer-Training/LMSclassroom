import './../bootstrap';

import { Queue, Worker } from 'bullmq';

import { runAnalyticsRollupCatchUp, runAnalyticsRollupDaily } from '@cio/analytics';
import { purgeAssetStorage } from '@cio/core/services/assets/assets';
import { runComplianceExpiryCheck, runComplianceReminderScan } from '@cio/core/services/compliance/scans';
import {
  deleteSystemEventsOlderThan,
  pruneDeadLetterJobsOlderThan,
  purgeDeadLetterJobsBatch,
  purgeExpiredSessionsBatch,
  purgeExpiredVerificationsBatch,
  purgeFinishedJobStepsBatch,
  purgeFinishedMediaJobsBatch,
  purgeReadNotificationsBatch,
  purgeRolledUpAnalyticsEventsBatch,
  reapStuckMediaJobs
} from '@cio/db/queries';
import {
  JOB_NAMES,
  QUEUE_NAMES,
  ZAnalyticsDailyRollupPayload,
  ZAssetStorageCleanupPayload,
  ZDeadLetterCleanupPayload,
  ZMediaJobReapPayload,
  ZRetentionCompactPayload,
  createRedisConnection
} from '@cio/jobs';

import { errorMessage } from '../utils/cancel';
import { log } from '../utils/logger';
import { isFlagEnabled, runBatchedPurge } from '../utils/purge';
import { withSingleRunLock } from '../utils/single-run';
import { registerShutdownTask } from '../utils/shutdown';

const connection = createRedisConnection();

// system_event_log retention (docs/HARDENING-PLAN.md LOG-1).
const SYSTEM_EVENT_RETENTION_DAYS = 90;

// Scheduler job template opts: BullMQ keeps every scheduler run forever unless told otherwise.
const SCHEDULED_JOB_RETENTION = { removeOnComplete: { count: 50 }, removeOnFail: { count: 200 } } as const;

// Retention purges (owner decision 5). Each is ON by default and has its own env flag (`=false` turns it off);
// RETENTION_PURGES_ENABLED=false is the master switch. audit_event is NEVER purged and has no flag because it has no purge.
const RETENTION_DEFAULT_DAYS = {
  notification: 90,
  deadLetterJob: 90,
  analyticsPageEvent: 180,
  jobStep: 90,
  mediaJob: 90
};

type RetentionWindows = Partial<Record<keyof typeof RETENTION_DEFAULT_DAYS, number>>;

async function runRetentionPurges(windows: RetentionWindows = {}) {
  if (!isFlagEnabled(process.env.RETENTION_PURGES_ENABLED, true)) {
    log.info('retention-purges-disabled', { flag: 'RETENTION_PURGES_ENABLED' });
    return { disabled: true };
  }

  const days = { ...RETENTION_DEFAULT_DAYS, ...windows };
  const purges: Array<{ name: string; flag: string; run: (batchSize: number) => Promise<number> }> = [
    { name: 'session', flag: 'RETENTION_SESSIONS_ENABLED', run: (size) => purgeExpiredSessionsBatch(size) },
    {
      name: 'verification',
      flag: 'RETENTION_VERIFICATIONS_ENABLED',
      run: (size) => purgeExpiredVerificationsBatch(size)
    },
    {
      name: 'notification',
      flag: 'RETENTION_NOTIFICATIONS_ENABLED',
      run: (size) => purgeReadNotificationsBatch(days.notification, size)
    },
    {
      name: 'dead_letter_job',
      flag: 'RETENTION_DEAD_LETTER_ENABLED',
      run: (size) => purgeDeadLetterJobsBatch(days.deadLetterJob, size)
    },
    {
      name: 'analytics_page_event',
      flag: 'RETENTION_ANALYTICS_EVENTS_ENABLED',
      run: (size) => purgeRolledUpAnalyticsEventsBatch(days.analyticsPageEvent, size)
    },
    {
      name: 'job_step',
      flag: 'RETENTION_JOB_RECORDS_ENABLED',
      run: (size) => purgeFinishedJobStepsBatch(days.jobStep, size)
    },
    {
      name: 'media_job',
      flag: 'RETENTION_JOB_RECORDS_ENABLED',
      run: (size) => purgeFinishedMediaJobsBatch(days.mediaJob, size)
    }
  ];

  const summary: Record<string, unknown> = {};
  for (const purge of purges) {
    if (!isFlagEnabled(process.env[purge.flag], true)) {
      summary[purge.name] = { skipped: purge.flag };
      continue;
    }

    try {
      summary[purge.name] = await runBatchedPurge(purge.run);
    } catch (error) {
      // One table failing must not stop the others; the next daily run retries it.
      summary[purge.name] = { error: errorMessage(error) };
      log.error('retention-purge-failed', { table: purge.name, error: errorMessage(error) });
    }
  }

  log.info('retention-purges-done', { summary });
  return summary;
}

/** Compliance scans must never overlap (two runs would race on the same status updates). */
const COMPLIANCE_SCAN_LOCK_TTL_MS = 30 * 60_000;

async function runComplianceScan(lockKey: string, scan: () => Promise<unknown>) {
  const outcome = await withSingleRunLock(connection, lockKey, COMPLIANCE_SCAN_LOCK_TTL_MS, scan);
  if (!outcome.ran) {
    log.warn('compliance-scan-already-running', { lockKey });
    return { skipped: 'already-running' };
  }

  return outcome.result;
}

const worker = new Worker(
  QUEUE_NAMES.maintenance,
  async (job) => {
    if (job.name === JOB_NAMES.maintenance.deadLetterCleanup) {
      const data = ZDeadLetterCleanupPayload.parse(job.data ?? {});
      const cutoff = new Date(Date.now() - data.olderThanDays * 86_400 * 1_000).toISOString();
      const deleted = await pruneDeadLetterJobsOlderThan(cutoff);
      log.info('dead-letter-cleanup-done', { deleted, cutoff });
      return { deleted };
    }

    if (job.name === JOB_NAMES.maintenance.retentionCompact) {
      const data = ZRetentionCompactPayload.parse(job.data ?? {});
      return runRetentionPurges(data.windowDays);
    }

    if (job.name === JOB_NAMES.maintenance.mediaJobReap) {
      const data = ZMediaJobReapPayload.parse(job.data ?? {});
      const cutoffIso = new Date(Date.now() - data.staleAfterMinutes * 60 * 1_000).toISOString();
      const reaped = await reapStuckMediaJobs(cutoffIso);

      if (reaped.length > 0) {
        log.warn('media-job-reap-done', {
          reaped: reaped.length,
          cutoffIso,
          ids: reaped.map((row) => row.id)
        });
      }

      return { reaped: reaped.length };
    }

    if (job.name === JOB_NAMES.maintenance.assetStorageCleanup) {
      const data = ZAssetStorageCleanupPayload.parse(job.data ?? {});
      await purgeAssetStorage(data);
      log.info('asset-storage-cleanup-done', {
        assetId: data.assetId,
        prefixes: data.prefixes.length,
        keys: data.keys.length
      });
      return { assetId: data.assetId };
    }

    if (job.name === JOB_NAMES.maintenance.analyticsDailyRollup) {
      const data = ZAnalyticsDailyRollupPayload.parse(job.data ?? {});
      // An explicit daysAgo (manual run) rolls just that day; the scheduled run (no payload) rolls yesterday plus
      // any days missed since the last rollup (max 14), so a down worker no longer leaves permanent gaps.
      const explicitDay = (job.data as { daysAgo?: number } | undefined)?.daysAgo !== undefined;
      const result = explicitDay
        ? await runAnalyticsRollupDaily({ daysAgo: data.daysAgo })
        : await runAnalyticsRollupCatchUp();
      log.info('analytics-rollup-done', { result });
      return result;
    }

    if (job.name === JOB_NAMES.maintenance.systemEventPurge) {
      const deleted = await deleteSystemEventsOlderThan(SYSTEM_EVENT_RETENTION_DAYS);
      log.info('system-event-purge-done', { deleted, retentionDays: SYSTEM_EVENT_RETENTION_DAYS });
      return { deleted };
    }

    if (job.name === JOB_NAMES.maintenance.complianceExpiryScan) {
      const result = await runComplianceScan('lock:compliance-expiry-scan', runComplianceExpiryCheck);
      log.info('compliance-expiry-scan-done', { result });
      return result;
    }

    if (job.name === JOB_NAMES.maintenance.complianceReminderScan) {
      const result = await runComplianceScan('lock:compliance-reminder-scan', runComplianceReminderScan);
      log.info('compliance-reminder-scan-done', { result });
      return result;
    }

    throw new Error(`Unknown maintenance job: ${job.name}`);
  },
  { connection, concurrency: 1 }
);

/**
 * BullMQ repeatable scheduler for the media-job reaper. `upsertJobScheduler`
 * is idempotent on the scheduler id, so it's safe to call on every worker
 * boot. Without this, stuck `media_job` rows would never get cleaned up.
 */
const MEDIA_JOB_REAP_INTERVAL_MS = 5 * 60 * 1_000;
// BullMQ requires a dedicated connection per Worker; give the Queue its own
// so the scheduler upsert doesn't piggyback on the worker's blocking client.
const schedulerConnection = createRedisConnection();
const maintenanceQueue = new Queue(QUEUE_NAMES.maintenance, { connection: schedulerConnection });

async function registerSchedulers(): Promise<void> {
  try {
    await maintenanceQueue.upsertJobScheduler(
      'media-job-reap-scheduler',
      { every: MEDIA_JOB_REAP_INTERVAL_MS },
      { name: JOB_NAMES.maintenance.mediaJobReap, data: {}, opts: SCHEDULED_JOB_RETENTION }
    );
    log.info('maintenance-scheduler-registered', {
      name: JOB_NAMES.maintenance.mediaJobReap,
      everyMs: MEDIA_JOB_REAP_INTERVAL_MS
    });

    // 00:15 UTC daily (a fixed wall-clock time, not "24h after whenever the worker booted", which drifted and
    // skipped days across restarts). attempts: a transient DB error no longer loses the day.
    await maintenanceQueue.upsertJobScheduler(
      'analytics-daily-rollup-scheduler',
      { pattern: '15 0 * * *' },
      {
        name: JOB_NAMES.maintenance.analyticsDailyRollup,
        data: {},
        opts: { ...SCHEDULED_JOB_RETENTION, attempts: 3, backoff: { type: 'exponential', delay: 60_000 } }
      }
    );
    log.info('analytics-rollup-scheduler-registered', {
      name: JOB_NAMES.maintenance.analyticsDailyRollup,
      pattern: '15 0 * * *'
    });

    await maintenanceQueue.upsertJobScheduler(
      'system-event-purge-scheduler',
      { every: 86_400_000 },
      { name: JOB_NAMES.maintenance.systemEventPurge, data: {}, opts: SCHEDULED_JOB_RETENTION }
    );
    log.info('system-event-purge-scheduler-registered', {
      name: JOB_NAMES.maintenance.systemEventPurge,
      everyMs: 86_400_000
    });

    // Batched retention purges, off-peak (03:30 UTC). Each table has its own env flag; see runRetentionPurges.
    await maintenanceQueue.upsertJobScheduler(
      'retention-compact-scheduler',
      { pattern: '30 3 * * *' },
      {
        name: JOB_NAMES.maintenance.retentionCompact,
        data: {},
        opts: { ...SCHEDULED_JOB_RETENTION, attempts: 2, backoff: { type: 'exponential', delay: 300_000 } }
      }
    );
    log.info('retention-compact-scheduler-registered', { pattern: '30 3 * * *' });

    // Compliance expiry scan (owner decision 11): daily 02:00 UTC. COMPLIANCE_EXPIRY_SCAN_ENABLED=false unschedules it.
    if (isFlagEnabled(process.env.COMPLIANCE_EXPIRY_SCAN_ENABLED, true)) {
      await maintenanceQueue.upsertJobScheduler(
        'compliance-expiry-scan-scheduler',
        { pattern: '0 2 * * *' },
        { name: JOB_NAMES.maintenance.complianceExpiryScan, data: {}, opts: SCHEDULED_JOB_RETENTION }
      );
      log.info('compliance-expiry-scan-scheduler-registered', { pattern: '0 2 * * *' });
    } else {
      await maintenanceQueue.removeJobScheduler('compliance-expiry-scan-scheduler');
    }

    // Reminder/status scan: OFF unless COMPLIANCE_REMINDER_SCAN_ENABLED=true (it moves learners to expiring_soon /
    // non_compliant, which changes dashboard numbers, so it needs an explicit owner go-ahead).
    if (isFlagEnabled(process.env.COMPLIANCE_REMINDER_SCAN_ENABLED, false)) {
      await maintenanceQueue.upsertJobScheduler(
        'compliance-reminder-scan-scheduler',
        { pattern: '30 2 * * *' },
        { name: JOB_NAMES.maintenance.complianceReminderScan, data: {}, opts: SCHEDULED_JOB_RETENTION }
      );
      log.info('compliance-reminder-scan-scheduler-registered', { pattern: '30 2 * * *' });
    } else {
      await maintenanceQueue.removeJobScheduler('compliance-reminder-scan-scheduler');
    }
  } catch (err) {
    log.error('maintenance-scheduler-register-failed', { error: errorMessage(err) });
  }
}

void registerSchedulers();

worker.on('ready', () => log.info('maintenance-worker-ready'));
worker.on('failed', (job, err) =>
  log.error('maintenance-job-failed', { jobName: job?.name, error: errorMessage(err) })
);
worker.on('error', (err) => log.error('maintenance-worker-error', { error: errorMessage(err) }));

registerShutdownTask('maintenance', async (force) => {
  await worker.close(force);
  await maintenanceQueue.close();
  await schedulerConnection.quit();
  await connection.quit();
});
