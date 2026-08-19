import * as z from 'zod';

import { defineEmail } from '../send';
import { getDefaultTemplate } from '../templates';
import { ZEmailBranding } from '../core/branding';
import { escapeHtml } from '../utils/functions/email-helpers';

// PearlLMS Phase-10 HP/SW-8 — the teacher-supplied customMessage + student/org/course names are HTML-escaped
// before interpolation into the learner's email (was raw → stored XSS).
export const studentCourseCompletionEmail = defineEmail({
  id: 'studentCourseCompletion',
  subject: 'Congratulations — you completed the course requirements',
  schema: z.object({
    orgName: z.string().min(1),
    courseName: z.string().min(1),
    studentName: z.string().min(1),
    certificateUrl: z.string().url(),
    customMessage: z.string().nullable().optional(),
    branding: ZEmailBranding
  }),
  render: (fields) => {
    const customBlock =
      fields.customMessage && fields.customMessage.trim().length > 0
        ? `<div style="margin:16px 0;padding:12px;border-left:3px solid #6366f1;background:#f8fafc;">${escapeHtml(fields.customMessage)}</div>`
        : '';

    const content = `
      <p>Hi ${escapeHtml(fields.studentName)},</p>
      <p>Congratulations! You have met the completion requirements for <strong>${escapeHtml(fields.courseName)}</strong>.</p>
      ${customBlock}
      <p><a href="${fields.certificateUrl}" style="display:inline-block;padding:10px 16px;background:#111827;color:#fff;text-decoration:none;border-radius:6px;">View your certificate</a></p>
      <p>If the button does not work, copy and paste this link into your browser:<br/><span style="word-break:break-all;">${fields.certificateUrl}</span></p>
      <p>Cheers,<br/>${escapeHtml(fields.orgName)}</p>
    `;

    return getDefaultTemplate(content, fields.branding);
  }
});
