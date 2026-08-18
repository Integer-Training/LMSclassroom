import { buildEmailBranding } from '@cio/email';
import { getAppBaseUrl, getDashboardBaseUrl } from '@cio/core/config/dashboard-url';
import { getCourseWithOrgData } from '@cio/db/queries/course';
import { getLessonById } from '@cio/db/queries/lesson';
import { getProfileById } from '@cio/db/queries/auth';
import { listTutorsForLearner } from '@cio/db/queries/allocation';
import { emitNotification } from '@api/services/comms/notify';

// Coursework notifications (PearlLMS Phase 3 Step 6 → migrated onto the Phase-6 framework). Exactly two
// events, both content-light — they say something happened and link to the app, carrying NO coursework, NO
// feedback text, NO result value, and no learner name. They now flow through the ONE notification pipeline
// (emitNotification): an in-app row is ALWAYS written per recipient, and the content-light email is sent
// only per the recipient's coursework-category preference (config default ON — same outward behaviour as
// before). Still fire-and-forget: the callers wrap them so a failure never rolls back the submission/marking
// write. COURSEWORK_EMAILS_ENABLED remains a global EMAIL kill-switch (it gates the email leg only; the
// in-app notification always fires).

/** Global EMAIL kill-switch, read at call time — default ON; `COURSEWORK_EMAILS_ENABLED="false"` disables
 * BOTH coursework emails (the in-app notifications still fire). Per-user opt-out is the preference layer. */
export function courseworkEmailsEnabled(): boolean {
  return process.env.COURSEWORK_EMAILS_ENABLED !== 'false';
}

interface UnitContext {
  learnerId: string;
  courseId: string;
  lessonId: string;
}

/**
 * Submission created → email the learner's ALLOCATED tutor(s). No allocated tutor → send nothing (the
 * awaiting-marking queue is the backstop); logged at debug. The tutor link goes to the admin/staff app
 * caseload (getAppBaseUrl), per the mailer link convention.
 */
export async function notifyCourseworkSubmitted(ctx: UnitContext): Promise<void> {
  const tutors = (await listTutorsForLearner(ctx.learnerId)).filter((t) => t.email);
  if (tutors.length === 0) {
    // No allocated tutor → no recipient at all (the awaiting-marking queue is the backstop). Nothing to notify.
    console.debug(
      `[coursework] submission by learner ${ctx.learnerId} on lesson ${ctx.lessonId}: no allocated tutor — no notification`
    );
    return;
  }

  const [course, lesson] = await Promise.all([getCourseWithOrgData(ctx.courseId), getLessonById(ctx.lessonId)]);
  if (!course) return;

  const branding = buildEmailBranding({ name: course.orgName, avatarUrl: course.orgAvatarUrl, theme: course.orgTheme });
  const emailFields = {
    courseTitle: course.courseTitle ?? 'your course',
    unitTitle: lesson?.title ?? 'a unit',
    caseloadUrl: `${getAppBaseUrl()}/caseload`,
    branding
  };

  await emitNotification({
    type: 'submission.created',
    // one in-app row per allocated tutor; the content-light email carries the SAME fields as before.
    recipients: tutors.map((t) => ({ userId: t.tutorId, email: t.email, emailFields })),
    entityType: 'lesson',
    entityId: ctx.lessonId,
    // COURSEWORK_EMAILS_ENABLED gates the email leg only — omitting the template = in-app only.
    emailTemplateId: courseworkEmailsEnabled() ? 'courseworkSubmitted' : undefined
  });
}

/**
 * Result recorded → email the LEARNER. The learner link goes to the org public dashboard
 * (getDashboardBaseUrl) at the unit page. No result value or feedback text travels in the email.
 */
export async function notifyCourseworkResulted(ctx: UnitContext): Promise<void> {
  const [learner, course, lesson] = await Promise.all([
    getProfileById(ctx.learnerId),
    getCourseWithOrgData(ctx.courseId),
    getLessonById(ctx.lessonId)
  ]);
  if (!course) return;

  const baseUrl = getDashboardBaseUrl({
    siteName: course.orgSiteName,
    customDomain: course.orgCustomDomain,
    isCustomDomainVerified: course.orgIsCustomDomainVerified
  });
  const branding = buildEmailBranding({ name: course.orgName, avatarUrl: course.orgAvatarUrl, theme: course.orgTheme });

  await emitNotification({
    type: 'result.recorded',
    // the learner always gets an in-app row; the content-light email (no result value, no feedback text) is
    // sent only if the learner has an email AND the coursework email leg is on.
    recipients: [
      {
        userId: ctx.learnerId,
        email: learner?.email ?? null,
        emailFields: {
          courseTitle: course.courseTitle ?? 'your course',
          unitTitle: lesson?.title ?? 'a unit',
          lessonUrl: `${baseUrl}/courses/${ctx.courseId}/lessons/${ctx.lessonId}`,
          branding
        }
      }
    ],
    entityType: 'lesson',
    entityId: ctx.lessonId,
    emailTemplateId: courseworkEmailsEnabled() ? 'courseworkResulted' : undefined
  });
}
