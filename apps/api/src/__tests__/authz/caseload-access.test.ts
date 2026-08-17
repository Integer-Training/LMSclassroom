import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@cio/db/actor';

// PearlLMS Phase 3 Step 4 — caseload data access. Two tutors with an OVERLAPPING learner (L2). Proves:
//  - the caseload roster is allocation-sourced, so tutor A can never see a learner allocated only to B;
//  - a tutor loading a learner they are not allocated to (URL-tamper) is denied 403; an Admin may view any;
//  - the "awaiting marking" queue is latest-version-per-unit, oldest-first.
// DB reads are mocked so only the service logic runs.

vi.mock('@cio/db/queries/allocation', () => ({
  listLearnersForTutor: vi.fn(),
  listAllocatedLearnersForOrg: vi.fn(),
  isTutorAllocatedToLearner: vi.fn()
}));
vi.mock('@cio/db/queries/coursework', () => ({
  getSubmissionsWithContextForLearners: vi.fn(),
  getSubmissionByFileKey: vi.fn()
}));
vi.mock('@cio/db/queries/auth', () => ({ getProfileById: vi.fn() }));

import {
  listAllocatedLearnersForOrg,
  listLearnersForTutor,
  isTutorAllocatedToLearner
} from '@cio/db/queries/allocation';
import { getSubmissionsWithContextForLearners } from '@cio/db/queries/coursework';
import { getProfileById } from '@cio/db/queries/auth';
import { getCaseloadLearnerDetail, getTutorCaseload } from '@api/services/caseload/caseload';

const mLearnersForTutor = vi.mocked(listLearnersForTutor);
const mLearnersForOrg = vi.mocked(listAllocatedLearnersForOrg);
const mAllocated = vi.mocked(isTutorAllocatedToLearner);
const mSubs = vi.mocked(getSubmissionsWithContextForLearners);
const mProfile = vi.mocked(getProfileById);

const ORG = 'org-1';
const tutorA: Actor = { authenticated: true, userId: 'u-tA', role: 'TUTOR', status: 'ACTIVE', orgId: ORG };
const tutorB: Actor = { authenticated: true, userId: 'u-tB', role: 'TUTOR', status: 'ACTIVE', orgId: ORG };
const admin: Actor = { authenticated: true, userId: 'u-admin', role: 'ADMIN', status: 'ACTIVE', orgId: ORG };

// tutor A → {L1, L2}; tutor B → {L2, L3}. L2 overlaps; L1 is A-only, L3 is B-only.
const L1 = 'u-L1',
  L2 = 'u-L2',
  L3 = 'u-L3';
const rosterA = [
  { learnerId: L1, name: 'Lea One', email: 'l1@x' },
  { learnerId: L2, name: 'Lea Two', email: 'l2@x' }
];

function sub(
  id: string,
  learnerId: string,
  lessonId: string,
  version: number,
  submittedAt: string,
  result: string | null = null
) {
  return {
    id,
    learnerId,
    courseId: 'C1',
    lessonId,
    version,
    files: [{ key: `coursework/C1/${learnerId}/${lessonId}/${version}/n-a.docx`, name: 'a.docx' }],
    status: 'submitted',
    submittedAt,
    courseTitle: 'Course One',
    unitTitle: `Unit ${lessonId}`,
    result
  } as never;
}

async function code(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 0;
  } catch (e) {
    return (e as { statusCode?: number })?.statusCode ?? -1;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  // getSubmissionsWithContextForLearners echoes only the learner ids it is fed (never widens).
  mSubs.mockImplementation(async (ids: string[]) => ALL_SUBS.filter((s: any) => ids.includes(s.learnerId)) as never);
});

// L1: unit U1 has v1(old) + v2(new), both awaiting. L2: unit U2 v1 awaiting. L3: unit U3 v1 (A must never see).
const ALL_SUBS = [
  sub('s-l1-u1-v1', L1, 'U1', 1, '2026-08-10T09:00:00Z'),
  sub('s-l1-u1-v2', L1, 'U1', 2, '2026-08-15T09:00:00Z'),
  sub('s-l2-u2-v1', L2, 'U2', 1, '2026-08-05T09:00:00Z'),
  sub('s-l3-u3-v1', L3, 'U3', 1, '2026-08-01T09:00:00Z')
];

describe('getTutorCaseload — allocation-sourced roster', () => {
  it("lists only the tutor's allocated learners, never a non-allocated one (L3)", async () => {
    mLearnersForTutor.mockResolvedValue(rosterA as never);
    const cl = await getTutorCaseload(tutorA);
    const ids = cl.learners.map((l) => l.learnerId).sort();
    expect(ids).toEqual([L1, L2]);
    expect(ids).not.toContain(L3);
    expect(mLearnersForTutor).toHaveBeenCalledWith('u-tA');
  });

  it('awaiting queue = latest version per unit, oldest-first', async () => {
    mLearnersForTutor.mockResolvedValue(rosterA as never);
    const cl = await getTutorCaseload(tutorA);
    // L2/U2 (2026-08-05) is older than L1/U1 v2 (2026-08-15); v1 of U1 is superseded and NOT queued.
    expect(cl.awaiting.map((a) => a.submissionId)).toEqual(['s-l2-u2-v1', 's-l1-u1-v2']);
  });

  it('Admin caseload is org-wide (allocation union), not per-tutor', async () => {
    mLearnersForOrg.mockResolvedValue([...rosterA, { learnerId: L3, name: 'Lea Three', email: 'l3@x' }] as never);
    const cl = await getTutorCaseload(admin);
    expect(cl.learners.map((l) => l.learnerId).sort()).toEqual([L1, L2, L3]);
    expect(mLearnersForOrg).toHaveBeenCalledWith(ORG);
    expect(mLearnersForTutor).not.toHaveBeenCalled();
  });

  it('an allocated learner with no submissions is still listed (empty)', async () => {
    mLearnersForTutor.mockResolvedValue([{ learnerId: 'u-empty', name: 'No Work', email: 'e@x' }] as never);
    const cl = await getTutorCaseload(tutorA);
    expect(cl.learners).toHaveLength(1);
    expect(cl.learners[0].courses).toEqual([]);
    expect(cl.awaiting).toEqual([]);
  });
});

describe('getCaseloadLearnerDetail — allocation-gated (URL-tamper defence)', () => {
  it('tutor allocated to the learner → detail with version history (newest first)', async () => {
    mAllocated.mockResolvedValue(true);
    mProfile.mockResolvedValue({ id: L1, fullname: 'Lea One', email: 'l1@x' } as never);
    const d = await getCaseloadLearnerDetail(tutorA, L1);
    expect(d.learner.id).toBe(L1);
    const versions = d.courses[0].units[0].submissions.map((s) => s.version);
    expect(versions).toEqual([2, 1]);
  });

  it('tutor NOT allocated (tutor B opening an A-only learner by id) → 403', async () => {
    mAllocated.mockResolvedValue(false);
    expect(await code(getCaseloadLearnerDetail(tutorB, L1))).toBe(403);
    expect(mProfile).not.toHaveBeenCalled(); // denied before any data load
  });

  it('Admin may view any learner (no allocation check)', async () => {
    mProfile.mockResolvedValue({ id: L3, fullname: 'Lea Three', email: 'l3@x' } as never);
    const d = await getCaseloadLearnerDetail(admin, L3);
    expect(d.learner.id).toBe(L3);
    expect(mAllocated).not.toHaveBeenCalled();
  });

  it('unknown learner → 404', async () => {
    mAllocated.mockResolvedValue(true);
    mProfile.mockResolvedValue(null as never);
    expect(await code(getCaseloadLearnerDetail(tutorA, 'u-ghost'))).toBe(404);
  });
});
