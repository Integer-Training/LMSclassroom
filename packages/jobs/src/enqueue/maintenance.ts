import type { JobsOptions } from 'bullmq';

import { JOB_NAMES, QUEUE_NAMES } from '../queues/names';
import { QUEUE_DEFAULTS } from '../queues/defaults';
import { getQueue } from '../queues/factories';
import type { TAssetStorageCleanupPayload } from '../payloads/maintenance';

/**
 * Enqueue a background sweep of a deleted asset's object-storage files. The
 * payload carries the concrete buckets/keys/prefixes because the asset row is
 * already deleted by the time this runs.
 */
export async function enqueueAssetStorageCleanup(payload: TAssetStorageCleanupPayload): Promise<string> {
  const job = await getQueue(QUEUE_NAMES.maintenance).add(
    JOB_NAMES.maintenance.assetStorageCleanup,
    payload,
    QUEUE_DEFAULTS[QUEUE_NAMES.maintenance]
  );

  return job.id ?? '';
}

/** One-minute bucket: a double-click / retrying cron client coalesces into one job instead of stacking scans. */
function minuteBucket(): number {
  return Math.floor(Date.now() / 60_000);
}

/** Enqueue a compliance expiry scan (the /internal/compliance/check-expiry endpoint). Runs in the jobs worker. */
export async function enqueueComplianceExpiryScan(options: JobsOptions = {}): Promise<string | undefined> {
  const job = await getQueue(QUEUE_NAMES.maintenance).add(
    JOB_NAMES.maintenance.complianceExpiryScan,
    {},
    { ...QUEUE_DEFAULTS[QUEUE_NAMES.maintenance], jobId: `compliance-expiry-scan-${minuteBucket()}`, ...options }
  );

  return job.id;
}

/** Enqueue a compliance reminder/status scan (the /internal/compliance/send-reminders endpoint). */
export async function enqueueComplianceReminderScan(options: JobsOptions = {}): Promise<string | undefined> {
  const job = await getQueue(QUEUE_NAMES.maintenance).add(
    JOB_NAMES.maintenance.complianceReminderScan,
    {},
    { ...QUEUE_DEFAULTS[QUEUE_NAMES.maintenance], jobId: `compliance-reminder-scan-${minuteBucket()}`, ...options }
  );

  return job.id;
}
