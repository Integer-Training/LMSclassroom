import * as z from 'zod';

import { defineEmail } from '../send';
import { getDefaultTemplate } from '../templates';
import { ZEmailBranding } from '../core/branding';

/**
 * PearlLMS Phase 6 Step 4 — sent to the OTHER participant when a message is posted to their thread.
 * Content-light by design: it says a new message is waiting and links to the conversation — it carries NO
 * message body, NO names beyond the generic "you have a new message". Coalesced per docs/COMMS-MODEL.md D3
 * (one email per thread while it has unread messages), so a burst of messages produces a single nudge.
 */
export const messageReceivedEmail = defineEmail({
  id: 'messageReceived',
  subject: 'You have a new message',
  schema: z.object({
    threadUrl: z.string().min(1),
    branding: ZEmailBranding
  }),
  render: (fields) => {
    const content = `
      <p>Hello,</p>
      <p>You have a new message waiting in your conversation.</p>
      <div>
        <a class="button" href="${fields.threadUrl}">Open the conversation</a>
      </div>
    `;

    return getDefaultTemplate(content, fields.branding);
  }
});
