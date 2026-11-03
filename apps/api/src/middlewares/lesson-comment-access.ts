import { Context, Next } from 'hono';
import { getGroupMemberIdByCourseAndProfile, isCourseTeamMemberOrOrgAdmin } from '@cio/db/queries/group';

import { ErrorCodes } from '@api/utils/errors';
import { getLessonCommentAuthorAndCourse } from '@cio/db/queries/lesson';

/**
 * Shared check for lesson comment edit/delete. Requires authMiddleware and courseMemberMiddleware first.
 * Expects commentId and courseId in route params. The comment must belong to a lesson of that course (404 otherwise).
 * With allowTeam, course team members (ADMIN/TUTOR) and org admins may act on others' comments too.
 */
const lessonCommentAccess = (allowTeam: boolean) => async (c: Context, next: Next) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
    }

    const commentId = Number(c.req.param('commentId'));
    const courseId = c.req.param('courseId');
    if (!courseId || !Number.isFinite(commentId)) {
      return c.json({ success: false, error: 'Comment ID is required', code: 'COMMENT_ID_REQUIRED' }, 400);
    }

    const commentInfo = await getLessonCommentAuthorAndCourse(commentId);
    if (!commentInfo || commentInfo.courseId !== courseId) {
      return c.json({ success: false, error: 'Comment not found', code: ErrorCodes.COMMENT_NOT_FOUND }, 404);
    }

    // lesson_comment.groupmember_id is a groupmember id, not a profile id
    const userGroupMemberId = await getGroupMemberIdByCourseAndProfile(courseId, user.id);
    if (userGroupMemberId && commentInfo.authorId && commentInfo.authorId === userGroupMemberId) {
      return next();
    }

    if (allowTeam && (await isCourseTeamMemberOrOrgAdmin(courseId, user.id))) {
      return next();
    }

    return c.json(
      {
        success: false,
        error: allowTeam
          ? 'Only the author or course team members can perform this action'
          : 'Only the author of this comment can edit it',
        code: ErrorCodes.ORG_TEAM_NOT_AUTHORIZED
      },
      403
    );
  } catch (error) {
    console.error('Error in lessonCommentAccess:', error);
    return c.json(
      { success: false, error: 'Failed to verify comment authorization', code: 'COMMENT_AUTH_CHECK_FAILED' },
      500
    );
  }
};

export const lessonCommentAuthorOnlyMiddleware = lessonCommentAccess(false);
export const lessonCommentAuthorOrTeamMiddleware = lessonCommentAccess(true);
