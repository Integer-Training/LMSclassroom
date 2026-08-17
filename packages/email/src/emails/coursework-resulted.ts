import * as z from 'zod';

import { defineEmail } from '../send';
import { getDefaultTemplate } from '../templates';
import { ZEmailBranding } from '../core/branding';

/**
 * PearlLMS Phase 3 Step 6 — sent to the LEARNER when their tutor records a result + feedback. Content-
 * light: it names the course + session and links to the unit. It carries NO result value ("Pass"/"Refer")
 * and NO feedback text — those live only in-app; the email just says feedback is available.
 */
export const courseworkResultedEmail = defineEmail({
  id: 'courseworkResulted',
  subject: 'Feedback is available on your coursework',
  schema: z.object({
    courseTitle: z.string().min(1),
    unitTitle: z.string().min(1),
    lessonUrl: z.string().min(1),
    branding: ZEmailBranding
  }),
  render: (fields) => {
    const content = `
      <p>Hello,</p>
      <p>Your tutor has recorded feedback on your coursework for <strong>${fields.courseTitle} — ${fields.unitTitle}</strong>.</p>
      <p>Log in to view your result and feedback.</p>
      <div>
        <a class="button" href="${fields.lessonUrl}">View feedback</a>
      </div>
    `;

    return getDefaultTemplate(content, fields.branding);
  }
});
