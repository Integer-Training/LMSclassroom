import * as z from 'zod';

import { defineEmail } from '../send';
import { getDefaultTemplate } from '../templates';
import { ZEmailBranding } from '../core/branding';
import { escapeHtml } from '../utils/functions/email-helpers';

// PearlLMS Phase-10 HP/SW-8 — the teacher-supplied customMessage + org/course names are HTML-escaped before
// interpolation into the learner's email (was raw → stored XSS into another user's inbox).
export const studentCourseWelcomeEmail = defineEmail({
  id: 'studentCourseWelcome',
  subject: (fields) => `You have access to ${fields.courseName} course`,
  schema: z.object({
    orgName: z.string().min(1),
    courseName: z.string().min(1),
    loginUrl: z.string().min(1),
    customMessage: z.string().optional(),
    branding: ZEmailBranding
  }),
  render: (fields) => {
    const hasCustomMessage = !!fields.customMessage && fields.customMessage.trim().length > 0;
    const orgName = escapeHtml(fields.orgName);
    const courseName = escapeHtml(fields.courseName);

    const intro = hasCustomMessage
      ? `<p>${escapeHtml(fields.customMessage as string)}</p>`
      : `
      <p>Hi there,</p>
      <p>You now have access to <strong>${courseName}</strong> in <strong>${orgName}</strong>.</p>
      <p>If you run into any issues, reach out to your instructor(s).</p>
      <p>Cheers,</p>
      <p>${orgName}</p>
    `;

    const content = `
      ${intro}
      <p><a href="${fields.loginUrl}">Sign in to the LMS</a> to open the course and start learning.</p>
    `;

    return getDefaultTemplate(content, fields.branding);
  }
});
