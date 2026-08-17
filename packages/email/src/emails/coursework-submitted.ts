import * as z from 'zod';

import { defineEmail } from '../send';
import { getDefaultTemplate } from '../templates';
import { ZEmailBranding } from '../core/branding';

/**
 * PearlLMS Phase 3 Step 6 — sent to a learner's ALLOCATED tutor(s) when the learner submits coursework.
 * Content-light by design: it names the course + session (structure, not the learner's work) and links
 * to the caseload. It carries NO learner name, NO coursework, NO feedback, NO result — it only says
 * something happened. The subject is generic (no PII), matching the stock submission emails.
 */
export const courseworkSubmittedEmail = defineEmail({
  id: 'courseworkSubmitted',
  subject: 'New coursework submitted by one of your learners',
  schema: z.object({
    courseTitle: z.string().min(1),
    unitTitle: z.string().min(1),
    caseloadUrl: z.string().min(1),
    branding: ZEmailBranding
  }),
  render: (fields) => {
    const content = `
      <p>Hello,</p>
      <p>One of your learners has submitted coursework on <strong>${fields.courseTitle} — ${fields.unitTitle}</strong>.</p>
      <p>Open your caseload to review it.</p>
      <div>
        <a class="button" href="${fields.caseloadUrl}">Open caseload</a>
      </div>
    `;

    return getDefaultTemplate(content, fields.branding);
  }
});
