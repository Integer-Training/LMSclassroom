import {
  ZCommunityComment,
  ZCommunityCommentDelete,
  ZCommunityQuestion,
  ZCommunityQuestionUpdate,
  ZCommunityQuestions,
  ZGetCommunity,
  ZGetCommunityCommentQuestionId,
  ZNewCommunityQuestion,
  ZUpvotePost,
  ZUpvotePostParam
} from '@cio/utils/validation/community';
import {
  createComment,
  createQuestion,
  deleteComment,
  deleteCommentsByQuestionId,
  deleteQuestion,
  editQuestion,
  fetchCommunityQuestion,
  fetchCommunityQuestions,
  upvote
} from '@api/services/community';

import { Hono } from '@api/utils/hono';
import { authMiddleware } from '@api/middlewares/auth';
import { commentAuthorOrTeamMiddleware } from './middlewares/comment-author-or-team';
import { handleError } from '@api/utils/errors';
import { orgMemberMiddleware } from '@api/middlewares/org-member';
import { orgTeamMemberMiddleware } from '@api/middlewares/org-team-member';
import { questionAuthorOrTeamMiddleware } from './middlewares/question-author-or-team';
import { requireSameOrg } from '@api/middlewares/guards';
import { zValidator } from '@hono/zod-validator';

export const communityRouter = new Hono()
  // requireSameOrg closes the cross-org read: the `?orgId` was taken from the query while only the
  // header org was validated, so a member of org A could read org B by pairing them (ACCESS.md F).
  .get(
    '/',
    authMiddleware,
    orgMemberMiddleware,
    requireSameOrg(),
    zValidator('query', ZCommunityQuestions),
    async (c) => {
      try {
        const { orgId } = c.req.valid('query');
        const user = c.get('user')!;
        const userRole = c.get('userRole');

        if (userRole === null) {
          return c.json(
            {
              success: false,
              error: 'Organization context not available',
              code: 'ORG_CONTEXT_MISSING'
            },
            500
          );
        }

        const result = await fetchCommunityQuestions(orgId, user.id, userRole);

        return c.json({ success: true, data: result }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to load community posts');
      }
    }
  )
  .get('/:slug', authMiddleware, orgMemberMiddleware, zValidator('param', ZCommunityQuestion), async (c) => {
    try {
      const { slug } = c.req.valid('param');

      const result = await fetchCommunityQuestion({ slug });

      return c.json({ success: true, data: result }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to load community post');
    }
  })
  .post('/', authMiddleware, orgMemberMiddleware, zValidator('json', ZNewCommunityQuestion), async (c) => {
    try {
      const { title, body, courseId, slug } = c.req.valid('json');
      // Author and org come from the authenticated session, NOT the request body — the body carried
      // authorProfileId/organizationId/votes, letting a caller post as another profile / another org
      // or seed votes (ACCESS.md gap G). The client's values for those fields are ignored.
      const user = c.get('user')!;
      const organizationId = c.get('orgId') ?? c.req.header('cio-org-id')!;

      const result = await createQuestion({
        title,
        body,
        courseId,
        organizationId,
        authorProfileId: user.id,
        votes: 0,
        slug
      });

      return c.json({ success: true, data: result }, 201);
    } catch (error) {
      return handleError(c, error, 'Failed to create community post');
    }
  })
  .put(
    '/:id',
    authMiddleware,
    questionAuthorOrTeamMiddleware,
    zValidator('param', ZGetCommunity),
    zValidator('json', ZCommunityQuestionUpdate),
    async (c) => {
      try {
        const { id } = c.req.valid('param');
        const { title, body, courseId } = c.req.valid('json');

        const result = await editQuestion({ id, title, body, courseId });

        return c.json({ success: true, data: result }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to update community post');
      }
    }
  )
  .delete('/:id', authMiddleware, questionAuthorOrTeamMiddleware, zValidator('param', ZGetCommunity), async (c) => {
    try {
      const { id } = c.req.valid('param');

      const result = await deleteQuestion({ id });

      return c.json({ success: true, data: result }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to delete community post');
    }
  })

  .post(
    '/:id/comment',
    authMiddleware,
    orgMemberMiddleware,
    zValidator('param', ZGetCommunity),
    zValidator('json', ZCommunityComment),
    async (c) => {
      try {
        const { id } = c.req.valid('param');
        const { body } = c.req.valid('json');
        // Author comes from the session, not the body (ACCESS.md gap G — body-spoofed authorProfileId).
        const user = c.get('user')!;

        const result = await createComment({
          body,
          questionId: id,
          authorProfileId: user.id,
          votes: 0
        });

        return c.json({ success: true, data: result }, 201);
      } catch (error) {
        return handleError(c, error, 'Failed to submit comment');
      }
    }
  )
  .post(
    '/:id/upvote',
    authMiddleware,
    orgMemberMiddleware,
    zValidator('param', ZUpvotePostParam),
    zValidator('json', ZUpvotePost),
    async (c) => {
      try {
        const { id } = c.req.valid('param');
        const { isQuestion } = c.req.valid('json');

        const result = await upvote({
          id,
          isQuestion
        });

        return c.json({ success: true, data: result }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to upvote post');
      }
    }
  )
  .delete(
    '/:id/comment',
    authMiddleware,
    commentAuthorOrTeamMiddleware,
    zValidator('param', ZCommunityCommentDelete),
    async (c) => {
      const { id } = c.req.valid('param');
      const result = await deleteComment({ id });
      return c.json({ success: true, data: result }, 200);
    }
  )
  .delete(
    '/:questionId/comments',
    authMiddleware,
    orgTeamMemberMiddleware,
    zValidator('param', ZGetCommunityCommentQuestionId),
    async (c) => {
      const { questionId } = c.req.valid('param');
      const result = await deleteCommentsByQuestionId({ questionId });
      return c.json({ success: true, data: result }, 200);
    }
  );
