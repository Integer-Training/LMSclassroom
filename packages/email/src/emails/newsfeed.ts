import * as z from 'zod';

import { defineEmail } from '../send';
import { getDefaultTemplate } from '../templates';
import { ZEmailBranding } from '../core/branding';
import { escapeHtml } from '../utils/functions/email-helpers';

// PearlLMS Phase-10 HP/SW-8 — user/org-supplied text (author name, course title, post/comment body) is
// HTML-escaped before interpolation so one user's newsfeed text cannot inject markup into another's email.

export const newsfeedPostEmail = defineEmail({
  id: 'newsfeedPost',
  subject: 'New post in course',
  schema: z.object({
    courseTitle: z.string().min(1),
    teacherName: z.string().min(1),
    content: z.string().min(1),
    postLink: z.url(),
    orgName: z.string().min(1),
    branding: ZEmailBranding
  }),
  render: (fields) => {
    const content = `
      <p>${escapeHtml(fields.teacherName)} made a post in a course you are taking: ${escapeHtml(fields.courseTitle)}.</p>
      <div style="font-style: italic; margin-top: 10px;">${escapeHtml(fields.content)}</div>
      <div>
        <a class="button" href="${fields.postLink}">View post</a>
      </div>
    `;

    return getDefaultTemplate(content, fields.branding);
  }
});

export const newsfeedCommentEmail = defineEmail({
  id: 'newsfeedComment',
  subject: 'News feed comment',
  schema: z.object({
    courseTitle: z.string().min(1),
    comment: z.string().min(1),
    postLink: z.url(),
    orgName: z.string().min(1),
    branding: ZEmailBranding
  }),
  render: (fields) => {
    const content = `
      <p>A student left you a comment on your newsfeed post</p>
      <div style="font-style: italic; margin-top: 10px;">${escapeHtml(fields.comment)}</div>
      <div>
        <a class="button" href="${fields.postLink}">View comment</a>
      </div>
    `;

    return getDefaultTemplate(content, fields.branding);
  }
});
