import {
  ZChangeUserRole,
  ZChangeUserStatus,
  ZCreateUser,
  ZLearnerProfile,
  ZListUsersQuery,
  ZUserMemberParam
} from '@cio/utils/validation/organization';
import {
  changeOrgUserRole,
  changeOrgUserStatus,
  createOrgUser,
  getLearnerProfile,
  listOrgUsers,
  updateLearnerProfile
} from '@api/services/organization/users';

import { Hono } from '@api/utils/hono';
import type { Actor } from '@cio/db/actor';
import { handleError } from '@api/utils/errors';
import { requireAdmin } from '@api/middlewares/guards';
import { zValidator } from '@hono/zod-validator';

// Admin user management (Phase 1 Step 7). ADMIN-only across the board (Manager/Tutor/Learner denied
// by requireAdmin — actor-based, fresh per request). Every mutation audits via recordAudit (in the
// service). Mounted at /organization/users.
export const usersRouter = new Hono()
  .get('/', requireAdmin, zValidator('query', ZListUsersQuery), async (c) => {
    try {
      const orgId = c.req.header('cio-org-id')!;
      const query = c.req.valid('query');
      const data = await listOrgUsers(orgId, query);
      return c.json({ success: true, data }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to list users');
    }
  })
  .post('/', requireAdmin, zValidator('json', ZCreateUser), async (c) => {
    try {
      const orgId = c.req.header('cio-org-id')!;
      const actor = c.get('actor') as Actor;
      const { name, email, roleId } = c.req.valid('json');
      const data = await createOrgUser(orgId, actor, { name, email, roleId });
      return c.json({ success: true, data }, 201);
    } catch (error) {
      return handleError(c, error, 'Failed to create user');
    }
  })
  .put(
    '/:memberId/role',
    requireAdmin,
    zValidator('param', ZUserMemberParam),
    zValidator('json', ZChangeUserRole),
    async (c) => {
      try {
        const orgId = c.req.header('cio-org-id')!;
        const actor = c.get('actor') as Actor;
        const { memberId } = c.req.valid('param');
        const { roleId } = c.req.valid('json');
        const data = await changeOrgUserRole(orgId, actor, memberId, roleId);
        return c.json({ success: true, data }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to change user role');
      }
    }
  )
  .put(
    '/:memberId/status',
    requireAdmin,
    zValidator('param', ZUserMemberParam),
    zValidator('json', ZChangeUserStatus),
    async (c) => {
      try {
        const orgId = c.req.header('cio-org-id')!;
        const actor = c.get('actor') as Actor;
        const { memberId } = c.req.valid('param');
        const { status } = c.req.valid('json');
        const data = await changeOrgUserStatus(orgId, actor, memberId, status);
        return c.json({ success: true, data }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to change user status');
      }
    }
  )
  // Enrolment PII — ADMIN ONLY (Tutor/Manager/Learner denied by requireAdmin, incl. a learner's own).
  .get('/:memberId/profile', requireAdmin, zValidator('param', ZUserMemberParam), async (c) => {
    try {
      const orgId = c.req.header('cio-org-id')!;
      const { memberId } = c.req.valid('param');
      const data = await getLearnerProfile(orgId, memberId);
      return c.json({ success: true, data }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to load learner profile');
    }
  })
  .put(
    '/:memberId/profile',
    requireAdmin,
    zValidator('param', ZUserMemberParam),
    zValidator('json', ZLearnerProfile),
    async (c) => {
      try {
        const orgId = c.req.header('cio-org-id')!;
        const actor = c.get('actor') as Actor;
        const { memberId } = c.req.valid('param');
        const input = c.req.valid('json');
        const data = await updateLearnerProfile(orgId, actor, memberId, input);
        return c.json({ success: true, data }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to update learner profile');
      }
    }
  );
