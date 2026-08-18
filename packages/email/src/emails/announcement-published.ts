import * as z from 'zod';

import { defineEmail } from '../send';
import { getDefaultTemplate } from '../templates';
import { ZEmailBranding } from '../core/branding';

/**
 * PearlLMS Phase 6 Step 5 — sent to recipients of a published announcement WHEN they have opted the
 * announcement category IN (the confirmed default is OFF, so this email is normally not sent — in-app only).
 * Content-light: it says a new announcement is available and links to the app — it carries NO title or body.
 */
export const announcementPublishedEmail = defineEmail({
  id: 'announcementPublished',
  subject: 'New announcement',
  schema: z.object({
    announcementsUrl: z.string().min(1),
    branding: ZEmailBranding
  }),
  render: (fields) => {
    const content = `
      <p>Hello,</p>
      <p>There's a new announcement for you.</p>
      <div>
        <a class="button" href="${fields.announcementsUrl}">Open</a>
      </div>
    `;

    return getDefaultTemplate(content, fields.branding);
  }
});
