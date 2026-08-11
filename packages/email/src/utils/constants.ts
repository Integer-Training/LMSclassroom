import { env } from '../config/env';

export const EMAIL_IDS = [
  'forgotPassword',
  'inviteTeacher',
  'newsfeedComment',
  'newsfeedPost',
  'onPasswordReset',
  'cohortGoalReminder',
  'quizAssigned',
  'sessionReminder',
  'sessionUpdated',
  'submissionGraded',
  'submissionReceived',
  'studentLimitReached',
  'studentLimitApproaching',
  'studentCourseInvite',
  'studentCourseCompletion',
  'studentCourseWelcome',
  'studentOrgInvite',
  'studentCohortWelcome',
  'studentProvePayment',
  'teacherCourseWelcome',
  'teacherStudentBuyRequest',
  'teacherStudentJoined',
  'verifyEmail',
  'welcome'
] as const;

// Fallback sender identity (branding — see docs/TODO-BRANDING.md). Both the from
// and reply-to are env-driven (SMTP_SENDER / SMTP_REPLY_TO); these defaults only
// apply when the env vars are unset.
const DEFAULT_EMAIL_FROM = '"Best from ClassroomIO" <notify@mail.classroomio.com>';
const DEFAULT_EMAIL_REPLY_TO = '"Best from ClassroomIO" <help@classroomio.com>';

export const EMAIL_FROM = env.SMTP_SENDER || DEFAULT_EMAIL_FROM;
export const EMAIL_REPLY_TO = env.SMTP_REPLY_TO || DEFAULT_EMAIL_REPLY_TO;
