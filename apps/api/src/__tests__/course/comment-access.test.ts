import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

// Lesson comment edit/delete: only the author may edit; the author or the course team / org admin may delete; the
// comment must belong to a lesson of the course in the URL. Newsfeed posts must belong to the course in the URL, and
// a reaction update may only change the caller's own entries.

vi.mock('@cio/db/queries/lesson', () => ({ getLessonCommentAuthorAndCourse: vi.fn() }));
vi.mock('@cio/db/queries/group', () => ({
  getGroupMemberIdByCourseAndProfile: vi.fn(),
  isCourseTeamMemberOrOrgAdmin: vi.fn()
}));
vi.mock('@cio/db/queries/newsfeed', () => ({
  getNewsfeedById: vi.fn(),
  updateNewsfeed: vi.fn(async (_id: string, data: { reaction: unknown }) => ({ id: 'f1', ...data }))
}));
vi.mock('@cio/core/utils/sanitize-html', () => ({ sanitizeHtml: (s: string) => s }));
vi.mock('@cio/core/config/env', () => ({ env: {} }));
vi.mock('@cio/email', () => ({ buildEmailFromName: vi.fn(), buildEmailBranding: vi.fn() }));
vi.mock('@api/services/jobs', () => ({ enqueueTransactionalEmail: vi.fn() }));

import { getLessonCommentAuthorAndCourse } from '@cio/db/queries/lesson';
import { getGroupMemberIdByCourseAndProfile, isCourseTeamMemberOrOrgAdmin } from '@cio/db/queries/group';
import { getNewsfeedById, updateNewsfeed } from '@cio/db/queries/newsfeed';
import {
  lessonCommentAuthorOnlyMiddleware,
  lessonCommentAuthorOrTeamMiddleware
} from '@api/middlewares/lesson-comment-access';
import { getNewsfeedItem, updateNewsfeedReactionService } from '@api/services/newsfeed/newsfeed';

const mockedComment = vi.mocked(getLessonCommentAuthorAndCourse);
const mockedMember = vi.mocked(getGroupMemberIdByCourseAndProfile);
const mockedTeam = vi.mocked(isCourseTeamMemberOrOrgAdmin);
const mockedFeed = vi.mocked(getNewsfeedById);
const mockedUpdate = vi.mocked(updateNewsfeed);

const app = new Hono()
  .use('*', async (c, next) => {
    c.set('user' as never, { id: 'p-1' } as never);
    await next();
  })
  .put('/course/:courseId/comment/:commentId', lessonCommentAuthorOnlyMiddleware, (c) => c.json({ ok: true }))
  .delete('/course/:courseId/comment/:commentId', lessonCommentAuthorOrTeamMiddleware, (c) => c.json({ ok: true }));

const edit = (courseId = 'c1') => app.request(`/course/${courseId}/comment/7`, { method: 'PUT' });
const del = (courseId = 'c1') => app.request(`/course/${courseId}/comment/7`, { method: 'DELETE' });

beforeEach(() => {
  vi.resetAllMocks();
  mockedUpdate.mockImplementation((async (_id: string, data: { reaction: unknown }) => ({
    id: 'f1',
    ...data
  })) as never);
});

describe('lesson comment access', () => {
  it('lets the author edit and delete', async () => {
    mockedComment.mockResolvedValue({ authorId: 'gm-1', courseId: 'c1' });
    mockedMember.mockResolvedValue('gm-1');
    expect((await edit()).status).toBe(200);
    expect((await del()).status).toBe(200);
  });

  it('blocks another member from editing, even a team member', async () => {
    mockedComment.mockResolvedValue({ authorId: 'gm-2', courseId: 'c1' });
    mockedMember.mockResolvedValue('gm-1');
    mockedTeam.mockResolvedValue(true);
    expect((await edit()).status).toBe(403);
  });

  it('blocks another learner from deleting', async () => {
    mockedComment.mockResolvedValue({ authorId: 'gm-2', courseId: 'c1' });
    mockedMember.mockResolvedValue('gm-1');
    mockedTeam.mockResolvedValue(false);
    expect((await del()).status).toBe(403);
  });

  it("lets a course team member or org admin delete someone else's comment", async () => {
    mockedComment.mockResolvedValue({ authorId: 'gm-2', courseId: 'c1' });
    mockedMember.mockResolvedValue('gm-1');
    mockedTeam.mockResolvedValue(true);
    expect((await del()).status).toBe(200);
  });

  it('returns 404 when the comment belongs to another course or does not exist', async () => {
    mockedComment.mockResolvedValue({ authorId: 'gm-1', courseId: 'other' });
    mockedMember.mockResolvedValue('gm-1');
    expect((await edit()).status).toBe(404);
    expect((await del()).status).toBe(404);
    mockedComment.mockResolvedValue(null);
    expect((await edit()).status).toBe(404);
  });
});

describe('newsfeed course scoping', () => {
  it('404s a post that belongs to a different course', async () => {
    mockedFeed.mockResolvedValue({ id: 'f1', courseId: 'other' } as never);
    await expect(getNewsfeedItem('f1', 'c1')).rejects.toMatchObject({ statusCode: 404 });
    await expect(updateNewsfeedReactionService('c1', 'f1', 'gm-1', {})).rejects.toMatchObject({ statusCode: 404 });
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('returns the post when it belongs to the course', async () => {
    mockedFeed.mockResolvedValue({ id: 'f1', courseId: 'c1' } as never);
    await expect(getNewsfeedItem('f1', 'c1')).resolves.toMatchObject({ id: 'f1' });
  });
});

describe('newsfeed reactions', () => {
  it("only applies the caller's own change and keeps everyone else's reactions", async () => {
    mockedFeed.mockResolvedValue({
      id: 'f1',
      courseId: 'c1',
      reaction: { clap: ['gm-2', 'gm-3'], smile: ['gm-1'], thumbsup: [], thumbsdown: ['gm-2'] }
    } as never);

    // The client tries to wipe everyone and remove its own smile, add its own clap
    await updateNewsfeedReactionService('c1', 'f1', 'gm-1', {
      clap: ['gm-1'],
      smile: [],
      thumbsup: [],
      thumbsdown: []
    });

    expect(mockedUpdate).toHaveBeenCalledWith('f1', {
      reaction: { clap: ['gm-2', 'gm-3', 'gm-1'], smile: [], thumbsup: [], thumbsdown: ['gm-2'] }
    });
  });

  it('ignores ids forged for other members', async () => {
    mockedFeed.mockResolvedValue({ id: 'f1', courseId: 'c1', reaction: {} } as never);
    await updateNewsfeedReactionService('c1', 'f1', 'gm-1', { clap: ['gm-9'], smile: ['gm-1'] });
    expect(mockedUpdate).toHaveBeenCalledWith('f1', {
      reaction: { clap: [], smile: ['gm-1'], thumbsup: [], thumbsdown: [] }
    });
  });
});
