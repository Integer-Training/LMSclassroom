import * as z from 'zod';

import { defineEmail } from '../send';
import { getDefaultTemplate } from '../templates';
import { ZEmailBranding } from '../core/branding';

/**
 * PearlLMS Phase 7 — sent to an org's Managers/Admins when a new learner registration is submitted (email
 * default ON for the `registration` category). Content-light: it says a new application is waiting and links
 * to the queue — it carries NO applicant PII (no name, email, or requested course). The details live in-app.
 */
export const registrationSubmittedEmail = defineEmail({
  id: 'registrationSubmitted',
  subject: 'New learner registration',
  schema: z.object({
    registrationsUrl: z.string().min(1),
    branding: ZEmailBranding
  }),
  render: (fields) => {
    const content = `
      <p>Hello,</p>
      <p>A new learner registration is waiting for review.</p>
      <div>
        <a class="button" href="${fields.registrationsUrl}">Open the registration queue</a>
      </div>
    `;

    return getDefaultTemplate(content, fields.branding);
  }
});
