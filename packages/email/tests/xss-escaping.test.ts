import { describe, expect, it } from 'vitest';

import { newsfeedPostEmail, newsfeedCommentEmail } from '../src/emails/newsfeed';
import { studentCourseWelcomeEmail } from '../src/emails/student-course-welcome';
import { studentCourseCompletionEmail } from '../src/emails/student-course-completion';

// PearlLMS Phase-10 Step-3 HP/SW-8 — user/org-supplied text in email templates must be HTML-escaped so one
// user's input cannot inject markup/script into another user's inbox (stored XSS). Each render must contain the
// escaped payload and never the raw <script> tag.

const XSS = '<script>alert(1)</script>';
const branding = { themeColor: '#111827', logoUrl: null, orgName: 'Org' } as never;
const render = (email: { template: { render: (f: never) => string } }, fields: Record<string, unknown>) =>
  email.template.render({ ...fields, branding } as never);

function assertEscaped(html: string) {
  expect(html).not.toContain('<script>alert(1)</script>');
  expect(html).toContain('&lt;script&gt;');
}

describe('email templates escape user/org text (HP/SW-8)', () => {
  it('newsfeedPost escapes teacherName, courseTitle and body', () => {
    assertEscaped(
      render(newsfeedPostEmail, {
        teacherName: XSS,
        courseTitle: XSS,
        content: XSS,
        postLink: 'https://x.test/p',
        orgName: 'Org'
      })
    );
  });

  it('newsfeedComment escapes the comment body', () => {
    assertEscaped(
      render(newsfeedCommentEmail, { courseTitle: 'C', comment: XSS, postLink: 'https://x.test/p', orgName: 'Org' })
    );
  });

  it('studentCourseWelcome escapes the teacher customMessage', () => {
    assertEscaped(
      render(studentCourseWelcomeEmail, {
        orgName: 'Org',
        courseName: 'C',
        loginUrl: 'https://x.test',
        customMessage: XSS
      })
    );
  });

  it('studentCourseCompletion escapes the customMessage, studentName and names', () => {
    assertEscaped(
      render(studentCourseCompletionEmail, {
        orgName: XSS,
        courseName: 'C',
        studentName: XSS,
        certificateUrl: 'https://x.test/c',
        customMessage: XSS
      })
    );
  });
});
