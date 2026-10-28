import { beforeEach, describe, expect, it, vi } from 'vitest';

// Phase E (compliance expiry .catch in tx) — a duplicate-key error swallowed inside db.transaction leaves the tx
// aborted and silently rolls back the expiry + certificate updates. The next cycle is now inserted with
// ON CONFLICT DO NOTHING (null = already there), so nothing ever raises inside the transaction.

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
  createCourseCompletionRecordIfAbsent: vi.fn(),
  getCourseComplianceHistoryRows: vi.fn(),
  getCourseCurrentComplianceRows: vi.fn(),
  getLatestComplianceRecordsByProfiles: vi.fn(),
  getOrgComplianceLearnerRows: vi.fn(),
  getStudentCourseMembersForCompliance: vi.fn(),
  listComplianceRecordsReadyForExpiry: vi.fn(),
  listLatestComplianceRecordsForReminderScan: vi.fn(),
  updateCourseCertificateIssueStatusByRecordId: vi.fn(async () => {}),
  updateCourseCompletionRecord: vi.fn(async () => ({}))
}));

import {
  createCourseCompletionRecordIfAbsent,
  listComplianceRecordsReadyForExpiry,
  updateCourseCertificateIssueStatusByRecordId,
  updateCourseCompletionRecord
} from '@cio/db/queries/course/compliance';
import { runComplianceExpiryCheck } from '@api/services/course/compliance';

const rec = (id: string, cycle: number) => ({
  id,
  courseId: 'c1',
  groupMemberId: 7,
  profileId: `p-${id}`,
  cycleNumber: cycle,
  validUntil: '2027-01-01T00:00:00.000Z'
});

beforeEach(() => vi.clearAllMocks());

describe('runComplianceExpiryCheck', () => {
  it('creates the next cycle on tx via ON CONFLICT DO NOTHING and counts it', async () => {
    vi.mocked(listComplianceRecordsReadyForExpiry).mockResolvedValue([rec('r1', 1)] as never);
    vi.mocked(createCourseCompletionRecordIfAbsent).mockResolvedValue({ id: 'new' } as never);

    const out = await runComplianceExpiryCheck();

    expect(out).toEqual({ processedCount: 1, createdCycleCount: 1, skippedCount: 0 });
    expect(vi.mocked(createCourseCompletionRecordIfAbsent).mock.calls[0]?.[0]).toMatchObject({ cycleNumber: 2 });
    expect(vi.mocked(createCourseCompletionRecordIfAbsent).mock.calls[0]?.[1]).toBe(TX);
  });

  it('an already-existing next cycle (null) is skipped, the expiry still commits, and nothing throws', async () => {
    vi.mocked(listComplianceRecordsReadyForExpiry).mockResolvedValue([rec('r1', 1), rec('r2', 4)] as never);
    vi.mocked(createCourseCompletionRecordIfAbsent)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'n' } as never);

    const out = await runComplianceExpiryCheck();

    expect(out).toEqual({ processedCount: 2, createdCycleCount: 1, skippedCount: 1 });
    expect(updateCourseCompletionRecord).toHaveBeenCalledTimes(2);
    expect(updateCourseCertificateIssueStatusByRecordId).toHaveBeenCalledTimes(2);
  });

  it('a record without validUntil is skipped before any transaction work', async () => {
    vi.mocked(listComplianceRecordsReadyForExpiry).mockResolvedValue([{ ...rec('r1', 1), validUntil: null }] as never);
    const out = await runComplianceExpiryCheck();
    expect(out).toEqual({ processedCount: 0, createdCycleCount: 0, skippedCount: 1 });
    expect(updateCourseCompletionRecord).not.toHaveBeenCalled();
  });
});
