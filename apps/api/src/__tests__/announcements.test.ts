import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@cio/db/actor';

// PearlLMS Phase 6 Step 5 — announcements SERVICE. Proves: POST is Admin/Manager only (Tutor + Learner
// denied — D1 refined); provider-wide vs course scope resolves the right recipients + audit scope;
// list visibility is role-scoped; announcement.published is emitted through the framework. DB mocked.

vi.mock('@cio/db/queries/comms', () => ({
  insertAnnouncement: vi.fn(async () => ({
    id: 'an1',
    organizationId: 'o1',
    authorId: 'u',
    courseId: null,
    title: 'T',
    body: 'B',
    publishedAt: 't',
    createdAt: 't'
  })),
  getAnnouncementById: vi.fn(),
  listAnnouncementsForLearner: vi.fn(async () => []),
  listAnnouncementsForOrg: vi.fn(async () => []),
  listAnnouncementsForCourse: vi.fn(async () => []),
  getEnrolledLearnerIds: vi.fn(async () => ['l1', 'l2']),
  getOrgLearnerIds: vi.fn(async () => ['l1', 'l2', 'l3'])
}));
vi.mock('@cio/db/queries/onboarding', () => ({
  getCourseEnrolmentTarget: vi.fn(async () => ({
    courseId: 'c1',
    title: 'iCQ',
    orgId: 'o1',
    isPublished: true,
    groupId: 'g1'
  })),
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
  listAnnouncementsForLearner,
  listAnnouncementsForOrg
} from '@cio/db/queries/comms';
import { getCourseEnrolmentTarget } from '@cio/db/queries/onboarding';
import { isEnrolledLearner } from '@api/middlewares/guards';
import { emitNotification } from '@api/services/comms/notify';
import { recordAudit } from '@cio/db/audit';
import { publishAnnouncement, listAnnouncements, listCourseAnnouncements } from '@api/services/comms/announcements';

const mInsert = vi.mocked(insertAnnouncement);
const mEnrolledIds = vi.mocked(getEnrolledLearnerIds);
const mOrgIds = vi.mocked(getOrgLearnerIds);
const mForLearner = vi.mocked(listAnnouncementsForLearner);
const mForOrg = vi.mocked(listAnnouncementsForOrg);
const mTarget = vi.mocked(getCourseEnrolmentTarget);
const mEnrolled = vi.mocked(isEnrolledLearner);
const mEmit = vi.mocked(emitNotification);
const mAudit = vi.mocked(recordAudit);

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

beforeEach(() => {
  vi.clearAllMocks();
  mInsert.mockResolvedValue({
    id: 'an1',
    organizationId: 'o1',
    authorId: 'u',
    courseId: null,
    title: 'T',
    body: 'B',
    publishedAt: 't',
    createdAt: 't'
  } as never);
  mTarget.mockResolvedValue({ courseId: 'c1', title: 'iCQ', orgId: 'o1', isPublished: true, groupId: 'g1' } as never);
  mEnrolledIds.mockResolvedValue(['l1', 'l2']);
  mOrgIds.mockResolvedValue(['l1', 'l2', 'l3']);
  mEnrolled.mockResolvedValue(false);
});

describe('publishAnnouncement — Admin/Manager only', () => {
  it('Manager publishes provider-wide → recipients = all org learners; audit scope provider-wide', async () => {
    await publishAnnouncement(manager, { courseId: null, title: 'Notice', body: 'Hello all' });
    expect(mInsert).toHaveBeenCalledWith(expect.objectContaining({ courseId: null, title: 'Notice' }));
    expect(mOrgIds).toHaveBeenCalledWith('o1');
    const emit = mEmit.mock.calls[0][0];
    expect(emit.type).toBe('announcement.published');
    expect(emit.recipients.map((r) => r.userId)).toEqual(['l1', 'l2', 'l3']);
    expect(emit.entityType).toBe('announcement');
    const audit = mAudit.mock.calls.find((c) => c[0].action === 'announcement.published')![0];
    expect(audit.metadata).toMatchObject({ scope: 'provider-wide', courseId: null });
  });

  it('Admin publishes course-scoped → validates published course, recipients = enrolled learners, audit scope course', async () => {
    mInsert.mockResolvedValue({
      id: 'an2',
      organizationId: 'o1',
      authorId: 'u',
      courseId: 'c1',
      title: 'T',
      body: 'B',
      publishedAt: 't',
      createdAt: 't'
    } as never);
    await publishAnnouncement(admin, { courseId: 'c1', title: 'Course notice', body: 'For this course' });
    expect(mInsert).toHaveBeenCalledWith(expect.objectContaining({ courseId: 'c1' }));
    expect(mEnrolledIds).toHaveBeenCalledWith('c1');
    expect(mEmit.mock.calls[0][0].recipients.map((r) => r.userId)).toEqual(['l1', 'l2']);
    const audit = mAudit.mock.calls.find((c) => c[0].action === 'announcement.published')![0];
    expect(audit.metadata).toMatchObject({ scope: 'course', courseId: 'c1' });
  });

  it('Tutor denied (403) — no insert, no emit, no audit', async () => {
    expect(await code(publishAnnouncement(tutor, { courseId: null, title: 'x', body: 'y' }))).toBe(403);
    expect(mInsert).not.toHaveBeenCalled();
    expect(mEmit).not.toHaveBeenCalled();
  });

  it('Learner denied (403)', async () => {
    expect(await code(publishAnnouncement(learner, { courseId: null, title: 'x', body: 'y' }))).toBe(403);
  });

  it('an unpublished course → 400; a foreign-org course → 404; empty title/body → 400', async () => {
    mTarget.mockResolvedValue({
      courseId: 'c1',
      title: 'Draft',
      orgId: 'o1',
      isPublished: false,
      groupId: 'g1'
    } as never);
    expect(await code(publishAnnouncement(admin, { courseId: 'c1', title: 't', body: 'b' }))).toBe(400);
    mTarget.mockResolvedValue({
      courseId: 'c1',
      title: 'X',
      orgId: 'other',
      isPublished: true,
      groupId: 'g1'
    } as never);
    expect(await code(publishAnnouncement(admin, { courseId: 'c1', title: 't', body: 'b' }))).toBe(404);
    mTarget.mockResolvedValue({ courseId: 'c1', title: 'X', orgId: 'o1', isPublished: true, groupId: 'g1' } as never);
    expect(await code(publishAnnouncement(admin, { courseId: null, title: '   ', body: 'b' }))).toBe(400);
  });
});

describe('list visibility — role-scoped', () => {
  it('staff feed = all org announcements', async () => {
    await listAnnouncements(admin);
    expect(mForOrg).toHaveBeenCalledWith('o1');
    await listAnnouncements(tutor);
    expect(mForOrg).toHaveBeenCalledWith('o1');
  });
  it('learner feed = provider-wide + their enrolled courses', async () => {
    await listAnnouncements(learner);
    expect(mForLearner).toHaveBeenCalledWith('o1', 'lrn');
    expect(mForOrg).not.toHaveBeenCalled();
  });
  it('course announcements: an enrolled learner sees them; an unenrolled learner is 403', async () => {
    mEnrolled.mockResolvedValue(true);
    expect(await code(listCourseAnnouncements(learner, 'c1'))).toBe(0);
    mEnrolled.mockResolvedValue(false);
    expect(await code(listCourseAnnouncements(learner, 'c1'))).toBe(403);
  });
  it("staff always see a course's announcements", async () => {
    expect(await code(listCourseAnnouncements(tutor, 'c1'))).toBe(0);
  });
});
