import { db } from '@cio/db/drizzle';
import {
  createCourseCompletionNotificationEvent,
  createCourseCompletionRecordsIfAbsentBulk,
  listComplianceRecordsReadyForExpiry,
  listLatestComplianceRecordsForReminderScan,
  updateCourseCertificateIssueStatusByRecordIds,
  updateCourseCompletionRecordsByIds
} from '@cio/db/queries/course/compliance';
import type { TCourse } from '@cio/db/types';

// Compliance scans that used to run INSIDE an HTTP request (/internal/compliance/*): they now run in the jobs
// worker (maintenance queue, scheduled or enqueued) and the routes are thin enqueue endpoints. Idempotent and safe to
// re-run: expiry only touches records not yet expired, cycle inserts are ON CONFLICT DO NOTHING, status updates only
// write a changed status, notification events are unique per (record, channel, event).

/** Records handled per transaction by the expiry scan. */
export const COMPLIANCE_EXPIRY_CHUNK_SIZE = 500;
/** Hard ceiling on chunks per run so a pathological backlog can never loop forever (500 x 200 = 100k records). */
const MAX_EXPIRY_CHUNKS = 200;

type ComplianceStatus =
  | 'not_started'
  | 'in_progress'
  | 'compliant'
  | 'expiring_soon'
  | 'in_grace_period'
  | 'non_compliant'
  | 'waived';
type ComplianceSettings = NonNullable<TCourse['compliance']>;

function getReminderEventType(daysUntilDue: number) {
  return `reminder_${daysUntilDue}d`;
}

function getWholeDaysUntil(startDate: Date, endDate: Date) {
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  return Math.ceil((endDate.getTime() - startDate.getTime()) / millisecondsPerDay);
}

/**
 * Expire every compliance record whose validity lapsed and open its next cycle. Chunked and set-based: per chunk of
 * 500 records ONE transaction does one UPDATE for expiredAt, one UPDATE for the certificates and one multi-row
 * INSERT ... ON CONFLICT DO NOTHING for the next cycle (null/absent = that cycle already existed, counted skipped).
 */
export async function runComplianceExpiryCheck() {
  const nowIso = new Date().toISOString();

  let processedCount = 0;
  let createdCycleCount = 0;
  let skippedCount = 0;

  for (let chunk = 0; chunk < MAX_EXPIRY_CHUNKS; chunk += 1) {
    const records = await listComplianceRecordsReadyForExpiry(nowIso, COMPLIANCE_EXPIRY_CHUNK_SIZE);
    if (records.length === 0) break;

    const due = records.filter((record) => record.validUntil);
    skippedCount += records.length - due.length;
    if (due.length === 0) break; // nothing in this chunk can make progress; avoid re-reading it forever

    await db.transaction(async (tx) => {
      const ids = due.map((record) => record.id);
      await updateCourseCompletionRecordsByIds(ids, { expiredAt: nowIso }, tx);
      await updateCourseCertificateIssueStatusByRecordIds(ids, 'expired', tx);

      const created = await createCourseCompletionRecordsIfAbsentBulk(
        due.map((record) => ({
          courseId: record.courseId,
          groupMemberId: record.groupMemberId,
          profileId: record.profileId,
          cycleNumber: record.cycleNumber + 1,
          status: 'not_started' as const,
          dueDate: record.validUntil as string,
          attempts: 0,
          timeSpentMinutes: 0
        })),
        tx
      );

      processedCount += due.length;
      createdCycleCount += created.length;
      skippedCount += due.length - created.length;
    });

    if (records.length < COMPLIANCE_EXPIRY_CHUNK_SIZE) break;
  }

  return {
    processedCount,
    createdCycleCount,
    skippedCount
  };
}

/**
 * Move open compliance records through expiring_soon / in_grace_period / non_compliant and record the reminder
 * events. Writes only (no email is sent here). Status changes are applied set-based, one UPDATE per target status.
 */
export async function runComplianceReminderScan() {
  const now = new Date();
  const rows = await listLatestComplianceRecordsForReminderScan();

  let scannedCount = 0;
  let statusUpdatedCount = 0;
  let reminderEventCount = 0;
  const idsByNextStatus = new Map<ComplianceStatus, string[]>();

  for (const row of rows) {
    scannedCount += 1;

    const compliance = row.course.compliance as ComplianceSettings | null;
    if (!compliance) {
      continue;
    }

    if (row.record.status === 'waived') {
      continue;
    }

    const dueDate = new Date(row.record.dueDate);
    if (Number.isNaN(dueDate.getTime())) {
      continue;
    }

    const daysUntilDue = getWholeDaysUntil(now, dueDate);
    const gracePeriodDays = compliance.gracePeriodDays ?? 0;
    let nextStatus: ComplianceStatus | null = null;

    if (daysUntilDue < 0) {
      const gracePeriodEndsAt = new Date(dueDate.getTime() + gracePeriodDays * 24 * 60 * 60 * 1000);
      nextStatus = gracePeriodDays > 0 && now <= gracePeriodEndsAt ? 'in_grace_period' : 'non_compliant';
    } else if ((compliance.reminderDaysBefore ?? []).includes(daysUntilDue)) {
      nextStatus = 'expiring_soon';

      const createdEvent = await createCourseCompletionNotificationEvent({
        courseCompletionRecordId: row.record.id,
        channel: 'email',
        eventType: getReminderEventType(daysUntilDue)
      });

      if (createdEvent) {
        reminderEventCount += 1;
      }
    }

    if (nextStatus && row.record.status !== nextStatus) {
      const ids = idsByNextStatus.get(nextStatus) ?? [];
      ids.push(row.record.id);
      idsByNextStatus.set(nextStatus, ids);
    }
  }

  for (const [status, ids] of idsByNextStatus) {
    statusUpdatedCount += await updateCourseCompletionRecordsByIds(ids, { status });
  }

  return {
    scannedCount,
    statusUpdatedCount,
    reminderEventCount
  };
}
