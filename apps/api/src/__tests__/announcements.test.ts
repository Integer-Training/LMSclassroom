import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@cio/db/actor';

// PearlLMS broadcasts SERVICE. Proves: compose/manage is ADMIN-ONLY (Manager/Tutor/Learner denied); each
// audience type resolves the right recipients; targets are validated; list visibility is role-scoped (admin →
// org manage, tutor → tutor-addressed, learner → scoped); archive/delete are admin-only; announcement.published
// is emitted through the framework. DB mocked.

const ROW = (over: Record<string, unknown> = {}) => ({
  id: 'an1',
  organizationId: 'o1',
  authorId: 'u',
  courseId: null,
  audienceType: 'all_learners',
  targetUserId: null,
  title: 'T',
  body: 'B',
  publishedAt: 't',
  createdAt: 't',
  archivedAt: null,
  deletedAt: null,
  ...over
});

vi.mock('@cio/db/queries/comms', () => ({
  insertAnnouncement: vi.fn(async () => ROW()),
  getAnnouncementById: vi.fn(async () => ROW()),
  listAnnouncementsForLearner: vi.fn(async () => []),
  listAnnouncementsForTutor: vi.fn(async () => []),
  listAnnouncementsForOrg: vi.fn(async () => []),
  listAnnouncementsForCourse: vi.fn(async () => []),
  getEnrolledLearnerIds: vi.fn(async () => ['l1', 'l2']),
  getOrgLearnerIds: vi.fn(async () => ['l1', 'l2', 'l3']),
  getOrgTutorIds: vi.fn(async () => ['t1', 't2']),
  listOrgTutors: vi.fn(async () => []),
  getProfileNamesByIds: vi.fn(async () => []),
  getCourseTitlesByIds: vi.fn(async () => []),
  setAnnouncementArchived: vi.fn(async () => ROW({ archivedAt: 't' })),
  softDeleteAnnouncement: vi.fn(async () => ROW({ deletedAt: 't' }))
}));
vi.mock('@cio/db/queries/allocation', () => ({
  getOrgMemberRoleId: vi.fn(async () => 3),
  listLearnersForTutor: vi.fn(async () => [{ learnerId: 'la', name: 'A', email: 'a@x' }])
}));
vi.mock('@cio/db/queries/audience', () => ({
  searchOrgAudience: vi.fn(async () => [{ profileId: 'l9', name: 'Nine', email: 'n@x' }])
}));
vi.mock('@cio/db/queries/onboarding', () => ({
  getCourseEnrolmentTarget: vi.fn(async () => ({ courseId: 'c1', orgId: 'o1', isPublished: true, groupId: 'g1' })),
  listPublishedCoursesForOrg: vi.fn(async () => [])
}));
vi.mock('@api/middlewares/guards', () => ({ isEnrolledLearner: vi.fn(async () => false) }));
vi.mock('@cio/db/queries/organization', () => ({ getOrganizationById: vi.fn(async () => ({ name: 'Org' })) }));
vi.mock('@api/services/comms/notify', () => ({ emitNotification: vi.fn(async () => {}) }));
vi.mock('@cio/db/audit', async (orig) => ({ ...(await orig<typeof import('@cio/db/audit')>()), recordAudit: vi.fn() }));
vi.mock('@cio/email', () => ({ buildEmailBranding: vi.fn(() => ({})) }));
vi.mock('@cio/core/config/dashboard-url', () => ({ getAppBaseUrl: vi.fn(() => 'http://app') }));

import {
  insertAnnouncement,
  getEnrolledLearnerIds,
  getOrgLearnerIds,
  getOrgTutorIds,
  listAnnouncementsForLearner,
  listAnnouncementsForTutor,
  listAnnouncementsForOrg,
  setAnnouncementArchived,
  softDeleteAnnouncement
} from '@cio/db/queries/comms';
import { getOrgMemberRoleId, listLearnersForTutor } from '@cio/db/queries/allocation';
import { getCourseEnrolmentTarget } from '@cio/db/queries/onboarding';
import { isEnrolledLearner } from '@api/middlewares/guards';
import { emitNotification } from '@api/services/comms/notify';
import { recordAudit } from '@cio/db/audit';
import {
  publishAnnouncement,
  listAnnouncements,
  listCourseAnnouncements,
  archiveAnnouncement,
  deleteAnnouncement
} from '@api/services/comms/announcements';

const mInsert = vi.mocked(insertAnnouncement);
const mEnrolledIds = vi.mocked(getEnrolledLearnerIds);
const mOrgIds = vi.mocked(getOrgLearnerIds);
const mTutorIds = vi.mocked(getOrgTutorIds);
const mForLearner = vi.mocked(listAnnouncementsForLearner);
const mForTutor = vi.mocked(listAnnouncementsForTutor);
const mForOrg = vi.mocked(listAnnouncementsForOrg);
const mRoleId = vi.mocked(getOrgMemberRoleId);
const mLearnersForTutor = vi.mocked(listLearnersForTutor);
const mTarget = vi.mocked(getCourseEnrolmentTarget);
const mEnrolled = vi.mocked(isEnrolledLearner);
const mEmit = vi.mocked(emitNotification);
const mAudit = vi.mocked(recordAudit);
const mArchive = vi.mocked(setAnnouncementArchived);
const mDelete = vi.mocked(softDeleteAnnouncement);

const A = (id: string, role: string): Actor =>
  ({ authenticated: true, userId: id, role, status: 'ACTIVE', orgId: 'o1' }) as Actor;
const admin = A('adm', 'ADMIN'),
  manager = A('mgr', 'MANAGER'),
  tutor = A('tut', 'TUTOR'),
  learner = A('lrn', 'LEARNER');

async function code(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 0;
  } catch (e) {
    return (e as { statusCode?: number })?.statusCode ?? -1;
  }
}

const base = { courseId: null, targetUserId: null };

beforeEach(() => {
  vi.clearAllMocks();
  mInsert.mockResolvedValue(ROW() as never);
  mTarget.mockResolvedValue({ courseId: 'c1', orgId: 'o1', isPublished: true, groupId: 'g1' } as never);
  mEnrolledIds.mockResolvedValue(['l1', 'l2']);
  mOrgIds.mockResolvedValue(['l1', 'l2', 'l3']);
  mTutorIds.mockResolvedValue(['t1', 't2']);
  mRoleId.mockResolvedValue(3);
  mLearnersForTutor.mockResolvedValue([{ learnerId: 'la', name: 'A', email: 'a@x' }] as never);
  mEnrolled.mockResolvedValue(false);
  mArchive.mockResolvedValue(ROW({ archivedAt: 't' }) as never);
  mDelete.mockResolvedValue(ROW({ deletedAt: 't' }) as never);
});

describe('publishAnnouncement — Admin only', () => {
  it('all_learners → recipients = all org learners', async () => {
    await publishAnnouncement(admin, { ...base, audienceType: 'all_learners', title: 'Notice', body: 'Hello all' });
    expect(mOrgIds).toHaveBeenCalledWith('o1');
    expect(mEmit.mock.calls[0][0].recipients.map((r) => r.userId)).toEqual(['l1', 'l2', 'l3']);
  });

  it('all_tutors → recipients = all org tutors', async () => {
    await publishAnnouncement(admin, { ...base, audienceType: 'all_tutors', title: 'Staff', body: 'FYI' });
    expect(mTutorIds).toHaveBeenCalledWith('o1');
    expect(mEmit.mock.calls[0][0].recipients.map((r) => r.userId)).toEqual(['t1', 't2']);
  });

  it('course → validates published course, recipients = enrolled learners', async () => {
    mInsert.mockResolvedValue(ROW({ id: 'an2', courseId: 'c1', audienceType: 'course' }) as never);
    await publishAnnouncement(admin, { ...base, audienceType: 'course', courseId: 'c1', title: 'C', body: 'B' });
    expect(mEnrolledIds).toHaveBeenCalledWith('c1');
    expect(mEmit.mock.calls[0][0].recipients.map((r) => r.userId)).toEqual(['l1', 'l2']);
  });

  it('learner → validates STUDENT role, recipient = that learner', async () => {
    mRoleId.mockResolvedValue(3);
    await publishAnnouncement(admin, {
      ...base,
      audienceType: 'learner',
      targetUserId: 'l7',
      title: 'Hi',
      body: 'You'
    });
    expect(mEmit.mock.calls[0][0].recipients.map((r) => r.userId)).toEqual(['l7']);
  });

  it('learner → non-student target 404', async () => {
    mRoleId.mockResolvedValue(2);
    expect(
      await code(
        publishAnnouncement(admin, { ...base, audienceType: 'learner', targetUserId: 'x', title: 'a', body: 'b' })
      )
    ).toBe(404);
  });

  it("tutor → validates TUTOR role, recipients = that tutor's learners", async () => {
    mRoleId.mockResolvedValue(2);
    await publishAnnouncement(admin, { ...base, audienceType: 'tutor', targetUserId: 't5', title: 'Hi', body: 'Team' });
    expect(mLearnersForTutor).toHaveBeenCalledWith('t5');
    expect(mEmit.mock.calls[0][0].recipients.map((r) => r.userId)).toEqual(['la']);
  });

  it('Manager denied (403) — no insert, no emit', async () => {
    expect(
      await code(publishAnnouncement(manager, { ...base, audienceType: 'all_learners', title: 'x', body: 'y' }))
    ).toBe(403);
    expect(mInsert).not.toHaveBeenCalled();
    expect(mEmit).not.toHaveBeenCalled();
  });

  it('Tutor + Learner denied (403)', async () => {
    expect(
      await code(publishAnnouncement(tutor, { ...base, audienceType: 'all_learners', title: 'x', body: 'y' }))
    ).toBe(403);
    expect(
      await code(publishAnnouncement(learner, { ...base, audienceType: 'all_learners', title: 'x', body: 'y' }))
    ).toBe(403);
  });

  it('unpublished course → 400; foreign-org course → 404; empty title → 400; missing course → 400', async () => {
    mTarget.mockResolvedValue({ courseId: 'c1', orgId: 'o1', isPublished: false, groupId: 'g1' } as never);
    expect(
      await code(publishAnnouncement(admin, { ...base, audienceType: 'course', courseId: 'c1', title: 't', body: 'b' }))
    ).toBe(400);
    mTarget.mockResolvedValue({ courseId: 'c1', orgId: 'other', isPublished: true, groupId: 'g1' } as never);
    expect(
      await code(publishAnnouncement(admin, { ...base, audienceType: 'course', courseId: 'c1', title: 't', body: 'b' }))
    ).toBe(404);
    expect(
      await code(publishAnnouncement(admin, { ...base, audienceType: 'all_learners', title: '   ', body: 'b' }))
    ).toBe(400);
    expect(
      await code(publishAnnouncement(admin, { ...base, audienceType: 'course', courseId: null, title: 't', body: 'b' }))
    ).toBe(400);
  });
});

describe('list visibility — role-scoped', () => {
  it('admin feed = all org broadcasts (manage)', async () => {
    await listAnnouncements(admin);
    expect(mForOrg).toHaveBeenCalledWith('o1');
  });
  it('tutor feed = tutor-addressed only (never the org manage list)', async () => {
    await listAnnouncements(tutor);
    expect(mForTutor).toHaveBeenCalledWith('o1', 'tut');
    expect(mForOrg).not.toHaveBeenCalled();
  });
  it('learner feed = scoped learner feed', async () => {
    await listAnnouncements(learner);
    expect(mForLearner).toHaveBeenCalledWith('o1', 'lrn');
    expect(mForOrg).not.toHaveBeenCalled();
  });
  it('course announcements: enrolled learner sees them; unenrolled learner 403; staff always', async () => {
    mEnrolled.mockResolvedValue(true);
    expect(await code(listCourseAnnouncements(learner, 'c1'))).toBe(0);
    mEnrolled.mockResolvedValue(false);
    expect(await code(listCourseAnnouncements(learner, 'c1'))).toBe(403);
    expect(await code(listCourseAnnouncements(tutor, 'c1'))).toBe(0);
  });
});

describe('archive / delete — Admin only', () => {
  it('admin archives + deletes; audits each', async () => {
    await archiveAnnouncement(admin, 'an1', true);
    expect(mArchive).toHaveBeenCalledWith('an1', 'o1', true);
    await deleteAnnouncement(admin, 'an1');
    expect(mDelete).toHaveBeenCalledWith('an1', 'o1');
    expect(mAudit).toHaveBeenCalled();
  });
  it('non-admin denied (403)', async () => {
    expect(await code(archiveAnnouncement(manager, 'an1', true))).toBe(403);
    expect(await code(deleteAnnouncement(tutor, 'an1'))).toBe(403);
    expect(mArchive).not.toHaveBeenCalled();
    expect(mDelete).not.toHaveBeenCalled();
  });
  it('missing row → 404', async () => {
    mArchive.mockResolvedValue(null as never);
    expect(await code(archiveAnnouncement(admin, 'nope', true))).toBe(404);
  });
});
