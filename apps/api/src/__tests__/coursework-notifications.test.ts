import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// PearlLMS Phase 3 Step 6 — the two coursework notifications, MIGRATED onto the Phase-6 framework (Step 2).
// Outward behaviour preserved: each event notifies the right recipient(s), bodies are content-light (no
// feedback text, no result value, no file, no learner name), and the COURSEWORK_EMAILS_ENABLED kill-switch
// disables the emails. DELIBERATE Phase-6 updates: (1) email is now enqueued PER RECIPIENT (so each user's
// per-category preference can gate their own email) — two tutors → two enqueues, not one batched call;
// (2) an in-app notification row is ALWAYS written, even when the email is suppressed (kill-switch off, or
// learner without an email). DB + mailer mocked; the real emitNotification runs on the mocked queries.

vi.mock('@api/services/jobs', () => ({ enqueueTransactionalEmail: vi.fn(async () => ({ jobIds: ['j1'] })) }));
vi.mock('@cio/db/queries/comms', () => ({
  insertNotification: vi.fn(async () => ({ id: 'n1' })),
  getNotificationPreference: vi.fn(async () => null), // no row → config default (coursework email ON)
  hasRecentUnreadForEntity: vi.fn(async () => false)
}));
vi.mock('@cio/db/queries/allocation', () => ({ listTutorsForLearner: vi.fn() }));
vi.mock('@cio/db/queries/course', () => ({ getCourseWithOrgData: vi.fn() }));
vi.mock('@cio/db/queries/lesson', () => ({ getLessonById: vi.fn() }));
vi.mock('@cio/db/queries/auth', () => ({ getProfileById: vi.fn() }));

import { enqueueTransactionalEmail } from '@api/services/jobs';
import { insertNotification } from '@cio/db/queries/comms';
import { listTutorsForLearner } from '@cio/db/queries/allocation';
import { getCourseWithOrgData } from '@cio/db/queries/course';
import { getLessonById } from '@cio/db/queries/lesson';
import { getProfileById } from '@cio/db/queries/auth';
import { notifyCourseworkResulted, notifyCourseworkSubmitted } from '@api/services/coursework/notifications';

const mEnqueue = vi.mocked(enqueueTransactionalEmail);
const mInsert = vi.mocked(insertNotification);
const mTutors = vi.mocked(listTutorsForLearner);
const mCourse = vi.mocked(getCourseWithOrgData);
const mLesson = vi.mocked(getLessonById);
const mProfile = vi.mocked(getProfileById);

const CTX = { learnerId: 'u-L1', courseId: 'c1', lessonId: 'l1' };
const COURSE = {
  courseTitle: 'Leadership L5',
  orgId: 'org-1',
  orgName: 'Integer Training',
  orgSiteName: 'integer',
  orgCustomDomain: null,
  orgIsCustomDomainVerified: null,
  orgAvatarUrl: null,
  orgTheme: null,
  groupId: 'g1',
  welcomeEmailMessage: null
};

/** A blob of everything the email was told to send, to assert nothing sensitive leaked into it. */
function payloadBlob(): string {
  return JSON.stringify(mEnqueue.mock.calls);
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.COURSEWORK_EMAILS_ENABLED;
  mInsert.mockResolvedValue({ id: 'n1' } as never);
  mCourse.mockResolvedValue(COURSE as never);
  mLesson.mockResolvedValue({ title: 'Session 2 - Identity check' } as never);
});
afterEach(() => {
  delete process.env.COURSEWORK_EMAILS_ENABLED;
});

describe('notifyCourseworkSubmitted — submission in → allocated tutor(s)', () => {
  it('emails the allocated tutor content-light AND writes an in-app row', async () => {
    mTutors.mockResolvedValue([{ tutorId: 't1', email: 'tutor@x.test' }] as never);
    await notifyCourseworkSubmitted(CTX);

    expect(mEnqueue).toHaveBeenCalledTimes(1);
    const [template, input] = mEnqueue.mock.calls[0];
    expect(template).toBe('courseworkSubmitted');
    expect(input.to).toBe('tutor@x.test'); // per-recipient now
    expect(input.fields).toMatchObject({ courseTitle: 'Leadership L5', unitTitle: 'Session 2 - Identity check' });
    // in-app row for the tutor, of the right type
    expect(mInsert).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 't1', type: 'submission.created', entityType: 'lesson', entityId: 'l1' })
    );
    // content-light: no feedback / result / file / learner-name / learner-id in the EMAIL payload
    const blob = payloadBlob();
    expect(blob).not.toMatch(/feedback/i);
    expect(blob).not.toMatch(/\bPASS\b|\bREFER\b/);
    expect(blob).not.toMatch(/\.docx|files?"/i);
    expect(blob).not.toContain('u-L1');
  });

  it('two allocated tutors → an email + in-app row EACH (per-recipient for preference gating)', async () => {
    mTutors.mockResolvedValue([
      { tutorId: 't1', email: 'a@x.test' },
      { tutorId: 't2', email: 'b@x.test' }
    ] as never);
    await notifyCourseworkSubmitted(CTX);
    expect(mEnqueue).toHaveBeenCalledTimes(2);
    expect(mEnqueue.mock.calls.map((c) => c[1].to).sort()).toEqual(['a@x.test', 'b@x.test']);
    expect(mInsert).toHaveBeenCalledTimes(2);
  });

  it('no allocated tutor → no recipient → no email and no in-app row', async () => {
    mTutors.mockResolvedValue([] as never);
    await notifyCourseworkSubmitted(CTX);
    expect(mEnqueue).not.toHaveBeenCalled();
    expect(mInsert).not.toHaveBeenCalled();
  });

  it('kill-switch off → NO email, but the in-app row STILL fires (deliberate Phase-6 change)', async () => {
    process.env.COURSEWORK_EMAILS_ENABLED = 'false';
    mTutors.mockResolvedValue([{ tutorId: 't1', email: 'tutor@x.test' }] as never);
    await notifyCourseworkSubmitted(CTX);
    expect(mEnqueue).not.toHaveBeenCalled();
    expect(mInsert).toHaveBeenCalledWith(expect.objectContaining({ userId: 't1', type: 'submission.created' }));
  });
});

describe('notifyCourseworkResulted — feedback out → learner', () => {
  it('emails the learner content-light (no result value/feedback) AND writes an in-app row', async () => {
    mProfile.mockResolvedValue({ id: 'u-L1', email: 'learner@x.test', fullname: 'Lea One' } as never);
    await notifyCourseworkResulted(CTX);

    expect(mEnqueue).toHaveBeenCalledTimes(1);
    const [template, input] = mEnqueue.mock.calls[0];
    expect(template).toBe('courseworkResulted');
    expect(input.to).toBe('learner@x.test');
    expect(mInsert).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u-L1', type: 'result.recorded', entityType: 'lesson', entityId: 'l1' })
    );
    const blob = payloadBlob();
    expect(blob).not.toMatch(/feedback/i);
    expect(blob).not.toMatch(/\bPASS\b|\bREFER\b/);
    expect(blob).not.toMatch(/\.docx/i);
  });

  it('learner without an email → NO email, but the in-app row STILL fires (deliberate Phase-6 change)', async () => {
    mProfile.mockResolvedValue({ id: 'u-L1', email: null, fullname: 'Lea One' } as never);
    await notifyCourseworkResulted(CTX);
    expect(mEnqueue).not.toHaveBeenCalled();
    expect(mInsert).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u-L1', type: 'result.recorded' }));
  });

  it('kill-switch off → NO email, in-app row still fires', async () => {
    process.env.COURSEWORK_EMAILS_ENABLED = 'false';
    mProfile.mockResolvedValue({ id: 'u-L1', email: 'learner@x.test', fullname: 'Lea One' } as never);
    await notifyCourseworkResulted(CTX);
    expect(mEnqueue).not.toHaveBeenCalled();
    expect(mInsert).toHaveBeenCalledTimes(1);
  });
});
