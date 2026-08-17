import { enqueueTransactionalEmail } from '@api/services/jobs';
import { buildEmailBranding } from '@cio/email';
import { getAppBaseUrl, getDashboardBaseUrl } from '@cio/core/config/dashboard-url';
import { getCourseWithOrgData } from '@cio/db/queries/course';
import { getLessonById } from '@cio/db/queries/lesson';
import { getProfileById } from '@cio/db/queries/auth';
import { listTutorsForLearner } from '@cio/db/queries/allocation';

// Minimal coursework notifications (PearlLMS Phase 3 Step 6). Exactly two events, both content-light —
// they say something happened and link to the app, carrying NO coursework, NO feedback text, NO result
// value, and no learner name. Sent through the stock BullMQ mailer (enqueueTransactionalEmail). These
// are fire-and-forget: the callers wrap them so a mail failure never rolls back the submission/marking
// write, and BullMQ owns retries. This is NOT the comms centre (announcements/messaging/preferences =
// Phase 6) — just the two nudges.

/** Single config toggle, read at call time — default ON; `COURSEWORK_EMAILS_ENABLED="false"` disables BOTH. */
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
  if (!courseworkEmailsEnabled()) return;

  const tutors = (await listTutorsForLearner(ctx.learnerId)).filter((t) => t.email);
  if (tutors.length === 0) {
    console.debug(
      `[coursework] submission by learner ${ctx.learnerId} on lesson ${ctx.lessonId}: no allocated tutor — no email sent`
    );
    return;
  }

  const [course, lesson] = await Promise.all([getCourseWithOrgData(ctx.courseId), getLessonById(ctx.lessonId)]);
  if (!course) return;

  const branding = buildEmailBranding({ name: course.orgName, avatarUrl: course.orgAvatarUrl, theme: course.orgTheme });

  await enqueueTransactionalEmail('courseworkSubmitted', {
    to: tutors.map((t) => t.email as string),
    fields: {
      courseTitle: course.courseTitle ?? 'your course',
      unitTitle: lesson?.title ?? 'a unit',
      caseloadUrl: `${getAppBaseUrl()}/caseload`,
      branding
    }
  });
}

/**
 * Result recorded → email the LEARNER. The learner link goes to the org public dashboard
 * (getDashboardBaseUrl) at the unit page. No result value or feedback text travels in the email.
 */
export async function notifyCourseworkResulted(ctx: UnitContext): Promise<void> {
  if (!courseworkEmailsEnabled()) return;

  const [learner, course, lesson] = await Promise.all([
    getProfileById(ctx.learnerId),
    getCourseWithOrgData(ctx.courseId),
    getLessonById(ctx.lessonId)
  ]);
  if (!learner?.email || !course) return;

  const baseUrl = getDashboardBaseUrl({
    siteName: course.orgSiteName,
    customDomain: course.orgCustomDomain,
    isCustomDomainVerified: course.orgIsCustomDomainVerified
  });
  const branding = buildEmailBranding({ name: course.orgName, avatarUrl: course.orgAvatarUrl, theme: course.orgTheme });

  await enqueueTransactionalEmail('courseworkResulted', {
    to: learner.email,
    fields: {
      courseTitle: course.courseTitle ?? 'your course',
      unitTitle: lesson?.title ?? 'a unit',
      lessonUrl: `${baseUrl}/courses/${ctx.courseId}/lessons/${ctx.lessonId}`,
      branding
    }
  });
}
