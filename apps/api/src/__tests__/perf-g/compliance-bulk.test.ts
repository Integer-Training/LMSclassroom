import { beforeEach, describe, expect, it, vi } from 'vitest';

// Phase G (bulk-ops-hold-connections) — compliance reset / extend / waive / enrolment-ensure are set-based: one
// latest-record lookup, one multi-row INSERT for missing records and one UPDATE ... IN for records that all get the
// same values (instead of an INSERT/UPDATE per learner). Result counts keep their meaning.

const TX = { __tx: true };
vi.mock('@cio/db/drizzle', () => ({
  db: { transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(TX)) }
}));
vi.mock('@api/middlewares/guards', () => ({ isAllocatedTutor: vi.fn() }));
vi.mock('@cio/db/queries/course', () => ({ getCourseById: vi.fn() }));
vi.mock('@cio/db/queries/course/compliance', () => ({
  createCourseCertificateIssue: vi.fn(),
  createCourseCompletionNotificationEvent: vi.fn(),
  createCourseCompletionRecord: vi.fn(),
  createCourseCompletionRecordIfAbsent: vi.fn(),
  createCourseCompletionRecordsBulk: vi.fn(async (rows: unknown[]) => rows),
  createCourseCompletionRecordsIfAbsentBulk: vi.fn(async (rows: unknown[]) => rows),
  getCourseComplianceHistoryRows: vi.fn(),
  getCourseCurrentComplianceRows: vi.fn(),
  getLatestComplianceRecordsByProfiles: vi.fn(),
  getOrgComplianceLearnerRows: vi.fn(),
  getStudentCourseMembersForCompliance: vi.fn(),
  listComplianceRecordsReadyForExpiry: vi.fn(),
  listLatestComplianceRecordsForReminderScan: vi.fn(),
  updateCourseCertificateIssueStatusByRecordId: vi.fn(),
  updateCourseCompletionRecord: vi.fn(async () => {
    throw new Error('per-learner update must not be used by the bulk paths');
  }),
  updateCourseCompletionRecordsByIds: vi.fn(async (ids: string[]) => ids.length)
}));

import {
  createCourseCompletionRecord,
  createCourseCompletionRecordsBulk,
  createCourseCompletionRecordsIfAbsentBulk,
  getLatestComplianceRecordsByProfiles,
  getStudentCourseMembersForCompliance,
  updateCourseCompletionRecordsByIds
} from '@cio/db/queries/course/compliance';
import { getCourseById } from '@cio/db/queries/course';
import {
  ensureComplianceEnrollmentRecordsForProfiles,
  extendCourseCompliance,
  resetCourseCompliance,
  waiveCourseCompliance
} from '@api/services/course/compliance';

const FUTURE = '2099-01-01T00:00:00.000Z';
const COURSE = { id: 'c1', type: 'COMPLIANCE', compliance: { enabled: true }, certificate: { deadline: FUTURE } };

const member = (i: number) => ({ member: { id: i, profileId: `p${i}` }, profile: null });
const rec = (i: number, over: Record<string, unknown> = {}) => ({
  id: `r${i}`,
  profileId: `p${i}`,
  cycleNumber: 1,
  completedAt: null,
  ...over
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCourseById).mockResolvedValue([COURSE] as never);
});

describe('resetCourseCompliance', () => {
  it('creates missing records in ONE insert and resets existing ones in ONE update, in one transaction', async () => {
    vi.mocked(getStudentCourseMembersForCompliance).mockResolvedValue([member(1), member(2), member(3)] as never);
    vi.mocked(getLatestComplianceRecordsByProfiles).mockResolvedValue([rec(1), rec(2)] as never);

    const out = await resetCourseCompliance('c1', { dueDate: FUTURE } as never);

    expect(out).toEqual({ createdCount: 1, updatedCount: 2, learnerCount: 3, dueDate: FUTURE });
    const created = vi.mocked(createCourseCompletionRecordsBulk).mock.calls[0]!;
    expect((created[0] as Array<{ profileId: string }>).map((r) => r.profileId)).toEqual(['p3']);
    expect(created[1]).toBe(TX);
    const [ids, values, client] = vi.mocked(updateCourseCompletionRecordsByIds).mock.calls[0]!;
    expect(ids).toEqual(['r1', 'r2']);
    expect(values).toMatchObject({ status: 'not_started', dueDate: FUTURE, completedAt: null, attempts: 0 });
    expect(client).toBe(TX);
  });
});

describe('extendCourseCompliance', () => {
  it('extends incomplete records, opens a first cycle where none exists and skips completed ones, with unchanged counts', async () => {
    vi.mocked(getStudentCourseMembersForCompliance).mockResolvedValue([
      member(1),
      member(2),
      member(3),
      member(4)
    ] as never);
    vi.mocked(getLatestComplianceRecordsByProfiles).mockResolvedValue([
      rec(1, { status: 'in_progress' }), // current incomplete -> extend
      rec(2, { status: 'compliant', completedAt: '2026-01-01', cycleNumber: 4 }), // completed -> skip
      rec(3, { status: 'non_compliant' }) // overdue but not completed -> extend
    ] as never);

    const out = await extendCourseCompliance('c1', { dueDate: FUTURE } as never);

    expect(out.skippedCount).toBe(1);
    const newRows = vi.mocked(createCourseCompletionRecordsBulk).mock.calls[0]![0] as Array<{
      profileId: string;
      cycleNumber: number;
    }>;
    expect(newRows.map((r) => `${r.profileId}#${r.cycleNumber}`)).toEqual(['p4#1']);
    expect(vi.mocked(updateCourseCompletionRecordsByIds).mock.calls[0]![0]).toEqual(['r1', 'r3']);
    expect(vi.mocked(updateCourseCompletionRecordsByIds).mock.calls[0]![1]).toEqual({ dueDate: FUTURE });
    expect(out).toMatchObject({ createdCount: 1, updatedCount: 2, learnerCount: 4 });
  });
});

describe('waiveCourseCompliance', () => {
  it('waives every current record with ONE update and counts records without one as skipped', async () => {
    vi.mocked(getStudentCourseMembersForCompliance).mockResolvedValue([member(1), member(2), member(3)] as never);
    vi.mocked(getLatestComplianceRecordsByProfiles).mockResolvedValue([rec(1), rec(2)] as never);

    const out = await waiveCourseCompliance('c1', 'actor-1', { waiverReason: 'medical' } as never);

    expect(out).toEqual({ updatedCount: 2, skippedCount: 1, learnerCount: 3, waiverExpiresAt: null });
    expect(updateCourseCompletionRecordsByIds).toHaveBeenCalledTimes(1);
    const [ids, values, client] = vi.mocked(updateCourseCompletionRecordsByIds).mock.calls[0]!;
    expect(ids).toEqual(['r1', 'r2']);
    expect(values).toEqual({ status: 'waived', waivedBy: 'actor-1', waiverReason: 'medical', waiverExpiresAt: null });
    expect(client).toBe(TX);
  });
});

describe('ensureComplianceEnrollmentRecordsForProfiles', () => {
  it('looks up latest records once per course for all learners and creates the missing first cycles in one insert', async () => {
    vi.mocked(getStudentCourseMembersForCompliance).mockResolvedValue([member(1), member(2), member(3)] as never);
    vi.mocked(getLatestComplianceRecordsByProfiles).mockResolvedValue([rec(2)] as never);

    const out = await ensureComplianceEnrollmentRecordsForProfiles(['c1'], ['p1', 'p2', 'p3']);

    expect(getLatestComplianceRecordsByProfiles).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getLatestComplianceRecordsByProfiles).mock.calls[0]).toEqual(['c1', ['p1', 'p2', 'p3']]);
    const rows = vi.mocked(createCourseCompletionRecordsIfAbsentBulk).mock.calls[0]![0] as Array<{
      profileId: string;
      cycleNumber: number;
      status: string;
      dueDate: string;
    }>;
    expect(rows.map((r) => r.profileId)).toEqual(['p1', 'p3']);
    expect(rows[0]).toMatchObject({ cycleNumber: 1, status: 'not_started', dueDate: FUTURE });
    expect(createCourseCompletionRecord).not.toHaveBeenCalled();
    expect(out).toEqual({ createdCount: 2 });
  });

  it('skips non-compliance courses without touching the records', async () => {
    vi.mocked(getCourseById).mockResolvedValue([{ ...COURSE, type: 'SELF_PACED' }] as never);
    const out = await ensureComplianceEnrollmentRecordsForProfiles(['c1'], ['p1']);
    expect(out).toEqual({ createdCount: 0 });
    expect(getLatestComplianceRecordsByProfiles).not.toHaveBeenCalled();
  });
});
