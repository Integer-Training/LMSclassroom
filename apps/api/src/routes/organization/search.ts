import { ZSearchOrganization } from '@cio/utils/validation/organization';

import { Hono } from '@api/utils/hono';
import { authMiddleware } from '@api/middlewares/auth';
import { handleError } from '@api/utils/errors';
import { orgMemberMiddleware } from '@api/middlewares/org-member';
import { orgAdminMiddleware } from '@api/middlewares/org-admin';
import { searchLmsOrganization, searchOrganization } from '@api/services/organization/search';
import { zValidator } from '@hono/zod-validator';

// PearlLMS Phase-10 HP/SW-3 — org people-search returns learner NAME + EMAIL (via searchOrgAudience); that PII is
// Admin-only (ACCESS.md §1.3, matching /organization/team + /audience which were already re-guarded to Admin).
// The search endpoint was left at team-member (TUTOR+), quietly re-opening the PII — tightened to Admin here.
export const searchRouter = new Hono()
  .get('/', authMiddleware, orgAdminMiddleware, zValidator('query', ZSearchOrganization), async (c) => {
    try {
      const orgId = c.req.header('cio-org-id')!;
      const { q, limit } = c.req.valid('query');
      const results = await searchOrganization(orgId, q, limit);

      return c.json({ success: true, data: results });
    } catch (error) {
      return handleError(c, error, 'Failed to search organization');
    }
  })
  .get('/lms', authMiddleware, orgMemberMiddleware, zValidator('query', ZSearchOrganization), async (c) => {
    try {
      const orgId = c.req.header('cio-org-id')!;
      const user = c.get('user')!;
      const { q, limit } = c.req.valid('query');
      const results = await searchLmsOrganization(orgId, user.id, q, limit);

      return c.json({ success: true, data: results });
    } catch (error) {
      return handleError(c, error, 'Failed to search LMS');
    }
  });
