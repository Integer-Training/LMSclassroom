import { beforeEach, describe, expect, it, vi } from 'vitest';

// Phase G (bulk-ops-hold-connections) — addCohortMembers does ONE email lookup and ONE membership lookup for the
// whole request, then chunked inserts in a transaction, instead of two queries + a transaction per member all
// running in parallel. The result shape ({ added, errors }, request order, "already a member" text) is unchanged,
// and a chunk whose transaction fails (e.g. plan student limit hit part-way) is replayed one member at a time.

const TX = { __tx: true };
vi.mock('@cio/db/drizzle', () => ({
  db: { transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(TX)) }
}));
vi.mock('@cio/db/queries/cohort', () => ({
  addCourseToCohort: vi.fn(),
  addCohortMember: vi.fn(),
  addCohortMembersBulk: vi.fn(),
  createCohortWithCreatorMembership: vi.fn(),
  createCohortNewsfeed: vi.fn(),
  createCohortNewsfeedComment: vi.fn(),
  deleteCohort: vi.fn(),
  deleteCohortNewsfeed: vi.fn(),
  deleteCohortNewsfeedComment: vi.fn(),
  getEnrolledCohortsByProfile: vi.fn(),
  getCohortById: vi.fn(),
  getCohortMemberByProfileId: vi.fn(),
  getExistingCohortMembers: vi.fn(),
  getCohortMembers: vi.fn(),
  getCohortNewsfeed: vi.fn(),
  getCohortNewsfeedById: vi.fn(),
  getCohortNewsfeedCommentById: vi.fn(),
  getCohortNewsfeedComments: vi.fn(),
  getCohortsByOrg: vi.fn(),
  getCoursesByCohort: vi.fn(),
  getCohortMemberRole: vi.fn(),
  isCohortCourse: vi.fn(),
  isCohortMember: vi.fn(),
  removeCourseFromCohort: vi.fn(),
  removeCohortMember: vi.fn(),
  updateCohort: vi.fn(),
  updateCohortMember: vi.fn(),
  updateCohortNewsfeed: vi.fn(),
  updateCohortNewsfeedReaction: vi.fn()
}));
vi.mock('@cio/db/queries/course', () => ({ getCourseGroupIds: vi.fn() }));
vi.mock('@cio/db/queries/group', () => ({ insertGroupMembersOnConflictDoNothing: vi.fn(async () => {}) }));
vi.mock('@cio/db/queries/auth', () => ({ getProfilesByEmails: vi.fn(async () => []) }));
vi.mock('@cio/db/queries/organization', () => ({
  getOrgMembersByProfileIds: vi.fn(async () => []),
  getOrganizationMemberIdByOrgAndProfile: vi.fn(async () => null),
  insertOrganizationMembersOnConflictDoNothing: vi.fn(async () => {})
}));
vi.mock('@api/services/organization/student-limit', () => ({ assertStudentCapacityOrThrow: vi.fn(async () => {}) }));
vi.mock('../../services/organization/student-limit', () => ({ assertStudentCapacityOrThrow: vi.fn(async () => {}) }));

import {
  addCohortMember,
  addCohortMembersBulk,
  getCohortById,
  getCoursesByCohort,
  getExistingCohortMembers
} from '@cio/db/queries/cohort';
import { getCourseGroupIds } from '@cio/db/queries/course';
import { insertGroupMembersOnConflictDoNothing } from '@cio/db/queries/group';
import { getProfilesByEmails } from '@cio/db/queries/auth';
import { getOrgMembersByProfileIds, insertOrganizationMembersOnConflictDoNothing } from '@cio/db/queries/organization';
import { assertStudentCapacityOrThrow } from '../../services/organization/student-limit';
import { addCohortMembers } from '@api/services/cohort/cohort';

const COHORT = { id: 'co1', organizationId: 'o1' };
const STUDENT = 3;
const TUTOR = 2;

const bulk = vi.mocked(addCohortMembersBulk);
const existing = vi.mocked(getExistingCohortMembers);
const profiles = vi.mocked(getProfilesByEmails);

/** Echo the inserted rows back as the DB would (id assigned), minus any profile ids in `conflicts`. */
function echoBulk(conflicts: string[] = []) {
  bulk.mockImplementation((async (rows: Array<Record<string, unknown>>) =>
    rows
      .filter((r) => !conflicts.includes(r.profileId as string))
      .map((r, i) => ({ id: `m-${r.profileId ?? i}`, ...r }))) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCohortById).mockResolvedValue(COHORT as never);
  vi.mocked(getCoursesByCohort).mockResolvedValue([{ course: { id: 'cr1' } }] as never);
  vi.mocked(getCourseGroupIds).mockResolvedValue([{ groupId: 'g1' }, { groupId: 'g2' }] as never);
  existing.mockResolvedValue(new Set());
  profiles.mockResolvedValue([]);
  vi.mocked(getOrgMembersByProfileIds).mockResolvedValue([]);
  vi.mocked(assertStudentCapacityOrThrow).mockResolvedValue(undefined);
  echoBulk();
});

describe('addCohortMembers — set-based', () => {
  it('resolves ALL emails with one lookup and checks ALL memberships with one lookup (no per-member queries)', async () => {
    profiles.mockResolvedValue([
      { id: 'p1', email: 'a@x.test' },
      { id: 'p2', email: 'b@x.test' }
    ] as never);
    const members = [
      { email: 'a@x.test', roleId: STUDENT },
      { email: 'b@x.test', roleId: STUDENT },
      { profileId: 'p3', roleId: TUTOR }
    ];
    const out = await addCohortMembers('co1', { members } as never);

    expect(profiles).toHaveBeenCalledTimes(1);
    expect(profiles.mock.calls[0]![0]).toEqual(['a@x.test', 'b@x.test']);
    expect(existing).toHaveBeenCalledTimes(1);
    expect(existing.mock.calls[0]![0]).toEqual([
      { cohortId: 'co1', profileId: 'p1' },
      { cohortId: 'co1', profileId: 'p2' },
      { cohortId: 'co1', profileId: 'p3' }
    ]);
    expect(bulk).toHaveBeenCalledTimes(1);
    expect(vi.mocked(addCohortMember)).not.toHaveBeenCalled();
    expect(out.errors).toEqual([]);
    expect(out.added.map((m) => (m as { profileId: string }).profileId)).toEqual(['p1', 'p2', 'p3']);
  });

  it('enrols new students in the cohort course groups: one org-member insert (new only), one group-member insert, capacity checked once for the chunk', async () => {
    vi.mocked(getOrgMembersByProfileIds).mockResolvedValue([
      { profileId: 'p2', email: null, roleId: STUDENT }
    ] as never);
    await addCohortMembers('co1', {
      members: [
        { profileId: 'p1', email: 'a@x.test', roleId: STUDENT },
        { profileId: 'p2', email: 'b@x.test', roleId: STUDENT },
        { profileId: 'p3', roleId: TUTOR }
      ]
    } as never);

    expect(assertStudentCapacityOrThrow).toHaveBeenCalledTimes(1);
    expect(vi.mocked(assertStudentCapacityOrThrow).mock.calls[0]).toEqual(['o1', 1, TX]); // only p1 is a NEW org member
    const orgRows = vi.mocked(insertOrganizationMembersOnConflictDoNothing).mock.calls[0]![0];
    expect(orgRows.map((r) => r.profileId)).toEqual(['p1']);
    const groupRows = vi.mocked(insertGroupMembersOnConflictDoNothing).mock.calls[0]![0];
    expect(groupRows.map((r) => `${r.profileId}:${r.groupId}`)).toEqual(['p1:g1', 'p1:g2', 'p2:g1', 'p2:g2']);
    // everything on the chunk transaction, never the pool
    expect(vi.mocked(insertGroupMembersOnConflictDoNothing).mock.calls[0]![1]).toBe(TX);
  });

  it('keeps the per-member result shape: already-members and duplicates land in errors with the same text, in request order', async () => {
    existing.mockResolvedValue(new Set(['co1:p1']));
    profiles.mockResolvedValue([{ id: 'p1', email: 'a@x.test' }] as never);
    const out = await addCohortMembers('co1', {
      members: [
        { email: 'a@x.test', roleId: STUDENT }, // already in the cohort
        { profileId: 'p2', email: 'b@x.test', roleId: STUDENT },
        { profileId: 'p2', email: 'b@x.test', roleId: STUDENT } // duplicate within the request
      ]
    } as never);

    expect(out.errors).toEqual([
      'a@x.test is already a member of this cohort',
      'b@x.test is already a member of this cohort'
    ]);
    expect(out.added).toHaveLength(1);
  });

  it('a member that loses a concurrent-add race (ON CONFLICT skipped it) is reported as already a member', async () => {
    echoBulk(['p2']);
    const out = await addCohortMembers('co1', {
      members: [
        { profileId: 'p1', email: 'a@x.test', roleId: TUTOR },
        { profileId: 'p2', email: 'b@x.test', roleId: TUTOR }
      ]
    } as never);
    expect(out.added).toHaveLength(1);
    expect(out.errors).toEqual(['b@x.test is already a member of this cohort']);
  });

  it('an email with no profile yet is still added (profile_id null), without being enrolled in course groups', async () => {
    const out = await addCohortMembers('co1', { members: [{ email: 'new@x.test', roleId: STUDENT }] } as never);
    expect(out.errors).toEqual([]);
    expect(bulk.mock.calls[0]![0][0]).toMatchObject({ profileId: null, email: 'new@x.test' });
    expect(vi.mocked(insertGroupMembersOnConflictDoNothing)).not.toHaveBeenCalled();
    expect(assertStudentCapacityOrThrow).not.toHaveBeenCalled();
  });

  it('processes 1,200 members in 3 chunk transactions of at most 500 (bounded connections), one result per member', async () => {
    const members = Array.from({ length: 1200 }, (_, i) => ({ profileId: `p${i}`, roleId: TUTOR }));
    const out = await addCohortMembers('co1', { members } as never);
    expect(bulk.mock.calls.map((c) => c[0].length)).toEqual([500, 500, 200]);
    expect(out.added).toHaveLength(1200);
    expect(existing).toHaveBeenCalledTimes(1);
  });
});

describe('addCohortMembers — failure isolation (capacity hit part-way)', () => {
  it('rolls the chunk back and replays it one member at a time, so earlier members still succeed and later ones get their own error', async () => {
    const limitError = Object.assign(new Error('Student limit reached'), { statusCode: 403 });
    // chunk-level check (n=2) fails; then per-member checks: first fits, second does not
    vi.mocked(assertStudentCapacityOrThrow)
      .mockRejectedValueOnce(limitError as never)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(limitError as never);
    vi.mocked(addCohortMember).mockImplementation((async (row: Record<string, unknown>) => ({
      id: `m-${row.profileId}`,
      ...row
    })) as never);

    const out = await addCohortMembers('co1', {
      members: [
        { profileId: 'p1', email: 'a@x.test', roleId: STUDENT },
        { profileId: 'p2', email: 'b@x.test', roleId: STUDENT }
      ]
    } as never);

    expect(vi.mocked(addCohortMember)).toHaveBeenCalledTimes(2);
    expect(out.added.map((m) => (m as { profileId: string }).profileId)).toEqual(['p1']);
    expect(out.errors).toEqual(['Student limit reached']);
  });
});
