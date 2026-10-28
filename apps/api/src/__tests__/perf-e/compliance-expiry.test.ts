import { beforeEach, describe, expect, it, vi } from 'vitest';

// Phase E (compliance expiry .catch in tx) + Phase J (chunked, set-based, runs in the jobs worker) — a duplicate-key
// error swallowed inside db.transaction leaves the tx aborted and silently rolls back the expiry + certificate
// updates. The next cycles are inserted with ON CONFLICT DO NOTHING (absent from the result = already there), so
// nothing ever raises inside the transaction; per chunk it is ONE update, ONE certificate update and ONE insert.

const TX = { __tx: true };
vi.mock('@cio/db/drizzle', () => ({
  db: { transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(TX)) }
}));
vi.mock('@api/middlewares/guards', () => ({ isAllocatedTutor: vi.fn() }));
vi.mock('@cio/db/queries/course', () => ({ getCourseById: vi.fn() }));
vi.mock('@cio/db/queries/course/compliance', () => ({
  createCourseCertificateIssue: vi.fn(),
  createCourseCompletionNotificationEvent: vi.fn(),
  createCourseCompletionRecord: vi.fn(async () => {
    throw new Error('must not be used for the next cycle');
  }),
  createCourseCompletionRecordsBulk: vi.fn(),
  createCourseCompletionRecordsIfAbsentBulk: vi.fn(),
  getCourseComplianceHistoryRows: vi.fn(),
  getCourseCurrentComplianceRows: vi.fn(),
  getLatestComplianceRecordsByProfiles: vi.fn(),
  getOrgComplianceLearnerRows: vi.fn(),
  getStudentCourseMembersForCompliance: vi.fn(),
  listComplianceRecordsReadyForExpiry: vi.fn(),
  listLatestComplianceRecordsForReminderScan: vi.fn(),
  updateCourseCertificateIssueStatusByRecordIds: vi.fn(async () => 0),
  updateCourseCompletionRecord: vi.fn(async () => ({})),
  updateCourseCompletionRecordsByIds: vi.fn(async (ids: string[]) => ids.length)
}));

import {
  createCourseCompletionNotificationEvent,
  createCourseCompletionRecordsIfAbsentBulk,
  listComplianceRecordsReadyForExpiry,
  listLatestComplianceRecordsForReminderScan,
  updateCourseCertificateIssueStatusByRecordIds,
  updateCourseCompletionRecordsByIds
} from '@cio/db/queries/course/compliance';
import { runComplianceExpiryCheck, runComplianceReminderScan } from '@api/services/course/compliance';

const rec = (id: string, cycle: number) => ({
  id,
  courseId: 'c1',
  groupMemberId: 7,
  profileId: `p-${id}`,
  cycleNumber: cycle,
  validUntil: '2027-01-01T00:00:00.000Z'
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listComplianceRecordsReadyForExpiry).mockReset();
});

describe('runComplianceExpiryCheck', () => {
  it('expires a chunk with one update, one certificate update and one ON CONFLICT insert, and counts the new cycles', async () => {
    vi.mocked(listComplianceRecordsReadyForExpiry).mockResolvedValue([rec('r1', 1)] as never);
    vi.mocked(createCourseCompletionRecordsIfAbsentBulk).mockResolvedValue([{ id: 'new' }] as never);

    const out = await runComplianceExpiryCheck();

    expect(out).toEqual({ processedCount: 1, createdCycleCount: 1, skippedCount: 0 });
    expect(updateCourseCompletionRecordsByIds).toHaveBeenCalledTimes(1);
    expect(vi.mocked(updateCourseCompletionRecordsByIds).mock.calls[0]?.[0]).toEqual(['r1']);
    expect(vi.mocked(updateCourseCompletionRecordsByIds).mock.calls[0]?.[2]).toBe(TX);
    expect(vi.mocked(updateCourseCertificateIssueStatusByRecordIds).mock.calls[0]).toEqual([['r1'], 'expired', TX]);
    const inserted = vi.mocked(createCourseCompletionRecordsIfAbsentBulk).mock.calls[0]?.[0];
    expect(inserted?.[0]).toMatchObject({ cycleNumber: 2, status: 'not_started', dueDate: '2027-01-01T00:00:00.000Z' });
    expect(vi.mocked(createCourseCompletionRecordsIfAbsentBulk).mock.calls[0]?.[1]).toBe(TX);
  });

  it('a next cycle that already exists is skipped (absent from the insert result), the expiry still commits, nothing throws', async () => {
    vi.mocked(listComplianceRecordsReadyForExpiry).mockResolvedValue([rec('r1', 1), rec('r2', 4)] as never);
    vi.mocked(createCourseCompletionRecordsIfAbsentBulk).mockResolvedValue([{ id: 'n' }] as never);

    const out = await runComplianceExpiryCheck();

    expect(out).toEqual({ processedCount: 2, createdCycleCount: 1, skippedCount: 1 });
    // Both records are expired in the SAME statement, not one UPDATE each.
    expect(updateCourseCompletionRecordsByIds).toHaveBeenCalledTimes(1);
    expect(vi.mocked(updateCourseCompletionRecordsByIds).mock.calls[0]?.[0]).toEqual(['r1', 'r2']);
  });

  it('a record without validUntil is skipped before any transaction work', async () => {
    vi.mocked(listComplianceRecordsReadyForExpiry).mockResolvedValue([{ ...rec('r1', 1), validUntil: null }] as never);
    const out = await runComplianceExpiryCheck();
    expect(out).toEqual({ processedCount: 0, createdCycleCount: 0, skippedCount: 1 });
    expect(updateCourseCompletionRecordsByIds).not.toHaveBeenCalled();
  });

  it('keeps reading chunks of 500 until a short chunk, one transaction per chunk', async () => {
    const full = Array.from({ length: 500 }, (_, i) => rec(`a${i}`, 1));
    vi.mocked(listComplianceRecordsReadyForExpiry)
      .mockResolvedValueOnce(full as never)
      .mockResolvedValueOnce([rec('z1', 1)] as never);
    vi.mocked(createCourseCompletionRecordsIfAbsentBulk).mockImplementation((async (values: unknown[]) =>
      values.map(() => ({ id: 'n' }))) as never);

    const out = await runComplianceExpiryCheck();

    expect(out).toEqual({ processedCount: 501, createdCycleCount: 501, skippedCount: 0 });
    expect(listComplianceRecordsReadyForExpiry).toHaveBeenCalledTimes(2);
    expect(vi.mocked(listComplianceRecordsReadyForExpiry).mock.calls[0]?.[1]).toBe(500);
    expect(updateCourseCompletionRecordsByIds).toHaveBeenCalledTimes(2);
  });
});

describe('runComplianceReminderScan', () => {
  const day = 24 * 60 * 60 * 1000;
  const row = (id: string, status: string, dueInDays: number, compliance: Record<string, unknown>) => ({
    course: { compliance },
    record: { id, status, dueDate: new Date(Date.now() + dueInDays * day - 1000).toISOString() }
  });

  it('groups status changes into one UPDATE per target status and records reminder events for the cadence days', async () => {
    vi.mocked(listLatestComplianceRecordsForReminderScan).mockResolvedValue([
      row('late1', 'in_progress', -10, { gracePeriodDays: 0 }),
      row('late2', 'in_progress', -10, { gracePeriodDays: 0 }),
      row('soon', 'in_progress', 7, { reminderDaysBefore: [7] }),
      row('fine', 'in_progress', 40, { reminderDaysBefore: [7] }),
      row('waived', 'waived', -10, { gracePeriodDays: 0 })
    ] as never);
    vi.mocked(createCourseCompletionNotificationEvent).mockResolvedValue({ id: 'e' } as never);

    const out = await runComplianceReminderScan();

    expect(out).toEqual({ scannedCount: 5, statusUpdatedCount: 3, reminderEventCount: 1 });
    const calls = vi.mocked(updateCourseCompletionRecordsByIds).mock.calls.map((c) => [c[0], c[1]]);
    expect(calls).toContainEqual([['late1', 'late2'], { status: 'non_compliant' }]);
    expect(calls).toContainEqual([['soon'], { status: 'expiring_soon' }]);
    expect(calls).toHaveLength(2);
  });
});
