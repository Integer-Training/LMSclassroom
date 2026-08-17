import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// PearlLMS Phase 3 Step 6 — the two coursework notifications. Asserts: each event enqueues exactly one
// send to the right recipient(s); bodies are content-light (no feedback text, no result value, no file,
// no learner name); no allocated tutor → no send; the config toggle disables both. DB + mailer mocked.

vi.mock('@api/services/jobs', () => ({ enqueueTransactionalEmail: vi.fn(async () => ({ jobIds: ['j1'] })) }));
vi.mock('@cio/db/queries/allocation', () => ({ listTutorsForLearner: vi.fn() }));
vi.mock('@cio/db/queries/course', () => ({ getCourseWithOrgData: vi.fn() }));
vi.mock('@cio/db/queries/lesson', () => ({ getLessonById: vi.fn() }));
vi.mock('@cio/db/queries/auth', () => ({ getProfileById: vi.fn() }));

import { enqueueTransactionalEmail } from '@api/services/jobs';
import { listTutorsForLearner } from '@cio/db/queries/allocation';
import { getCourseWithOrgData } from '@cio/db/queries/course';
import { getLessonById } from '@cio/db/queries/lesson';
import { getProfileById } from '@cio/db/queries/auth';
import { notifyCourseworkResulted, notifyCourseworkSubmitted } from '@api/services/coursework/notifications';

const mEnqueue = vi.mocked(enqueueTransactionalEmail);
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
  mCourse.mockResolvedValue(COURSE as never);
  mLesson.mockResolvedValue({ title: 'Session 2 - Identity check' } as never);
});
afterEach(() => {
  delete process.env.COURSEWORK_EMAILS_ENABLED;
});

describe('notifyCourseworkSubmitted — submission in → allocated tutor(s)', () => {
  it('sends exactly one template to the allocated tutor(s), content-light', async () => {
    mTutors.mockResolvedValue([{ tutorId: 't1', email: 'tutor@x.test' }] as never);
    await notifyCourseworkSubmitted(CTX);

    expect(mEnqueue).toHaveBeenCalledTimes(1);
    const [template, input] = mEnqueue.mock.calls[0];
    expect(template).toBe('courseworkSubmitted');
    expect(input.to).toEqual(['tutor@x.test']);
    expect(input.fields).toMatchObject({ courseTitle: 'Leadership L5', unitTitle: 'Session 2 - Identity check' });
    // content-light: no feedback / result / file / learner-name / learner-id fields anywhere
    const blob = payloadBlob();
    expect(blob).not.toMatch(/feedback/i);
    expect(blob).not.toMatch(/\bPASS\b|\bREFER\b/);
    expect(blob).not.toMatch(/\.docx|files?"/i);
    expect(blob).not.toContain('u-L1');
  });

  it('two allocated tutors → still ONE enqueue call, both recipients', async () => {
    mTutors.mockResolvedValue([
      { tutorId: 't1', email: 'a@x.test' },
      { tutorId: 't2', email: 'b@x.test' }
    ] as never);
    await notifyCourseworkSubmitted(CTX);
    expect(mEnqueue).toHaveBeenCalledTimes(1);
    expect(mEnqueue.mock.calls[0][1].to).toEqual(['a@x.test', 'b@x.test']);
  });

  it('no allocated tutor → no send (awaiting-marking queue is the backstop)', async () => {
    mTutors.mockResolvedValue([] as never);
    await notifyCourseworkSubmitted(CTX);
    expect(mEnqueue).not.toHaveBeenCalled();
  });

  it('toggle off → no send', async () => {
    process.env.COURSEWORK_EMAILS_ENABLED = 'false';
    mTutors.mockResolvedValue([{ tutorId: 't1', email: 'tutor@x.test' }] as never);
    await notifyCourseworkSubmitted(CTX);
    expect(mEnqueue).not.toHaveBeenCalled();
  });
});

describe('notifyCourseworkResulted — feedback out → learner', () => {
  it('sends exactly one template to the learner, no result value or feedback text', async () => {
    mProfile.mockResolvedValue({ id: 'u-L1', email: 'learner@x.test', fullname: 'Lea One' } as never);
    await notifyCourseworkResulted(CTX);

    expect(mEnqueue).toHaveBeenCalledTimes(1);
    const [template, input] = mEnqueue.mock.calls[0];
    expect(template).toBe('courseworkResulted');
    expect(input.to).toBe('learner@x.test');
    const blob = payloadBlob();
    expect(blob).not.toMatch(/feedback/i);
    expect(blob).not.toMatch(/\bPASS\b|\bREFER\b/);
    expect(blob).not.toMatch(/\.docx/i);
  });

  it('learner without an email → no send', async () => {
    mProfile.mockResolvedValue({ id: 'u-L1', email: null, fullname: 'Lea One' } as never);
    await notifyCourseworkResulted(CTX);
    expect(mEnqueue).not.toHaveBeenCalled();
  });

  it('toggle off → no send', async () => {
    process.env.COURSEWORK_EMAILS_ENABLED = 'false';
    mProfile.mockResolvedValue({ id: 'u-L1', email: 'learner@x.test', fullname: 'Lea One' } as never);
    await notifyCourseworkResulted(CTX);
    expect(mEnqueue).not.toHaveBeenCalled();
  });
});
