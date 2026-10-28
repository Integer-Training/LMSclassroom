import {
  ZAllocationCreate,
  ZAllocationIdParam,
  ZAllocationListQuery,
  ZAssignablePeopleQuery
} from '@cio/utils/validation/coursework';
import {
  createTutorAllocation,
  listOrgAllocations,
  removeTutorAllocation,
  searchAssignablePeopleForOrg
} from '@api/services/organization/allocation';

import { Hono } from '@api/utils/hono';
import type { Actor } from '@cio/db/actor';
import { handleError } from '@api/utils/errors';
import { requireManagerOrAdmin } from '@api/middlewares/guards';
import { zValidator } from '@hono/zod-validator';

// Tutor↔learner allocation management (PearlLMS Phase 3). Manager OR Admin across the board
// (requireManagerOrAdmin — Tutor and Learner are denied, actor-based, fresh per request). Allocations
// are provider-wide pairs; every mutation audits in the service (ids only). Mounted at
// /organization/allocations.
export const allocationsRouter = new Hono()
  .get('/', requireManagerOrAdmin, zValidator('query', ZAllocationListQuery), async (c) => {
    try {
      // Org comes from the RESOLVED actor, never a client-supplied header — a Manager/Admin can only
      // ever act on their own org's allocations (single-org today; correct + header-proof for multi-org).
      const orgId = (c.get('actor') as Extract<Actor, { authenticated: true }>).orgId;
      const data = await listOrgAllocations(orgId, c.req.valid('query'));
      return c.json({ success: true, data }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to list allocations');
    }
  })
  // Typeahead picker for the assign form (one side per call, capped at 20). Static path — registered before
  // /:allocationId.
  .get('/assignable', requireManagerOrAdmin, zValidator('query', ZAssignablePeopleQuery), async (c) => {
    try {
      // Org comes from the RESOLVED actor, never a client-supplied header — a Manager/Admin can only
      // ever act on their own org's allocations (single-org today; correct + header-proof for multi-org).
      const orgId = (c.get('actor') as Extract<Actor, { authenticated: true }>).orgId;
      const { role, search, pairedWith } = c.req.valid('query');
      const data = await searchAssignablePeopleForOrg(orgId, { role, search, excludePairedWith: pairedWith });
      return c.json({ success: true, data }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to load assignable people');
    }
  })
  .post('/', requireManagerOrAdmin, zValidator('json', ZAllocationCreate), async (c) => {
    try {
      // Org comes from the RESOLVED actor, never a client-supplied header — a Manager/Admin can only
      // ever act on their own org's allocations (single-org today; correct + header-proof for multi-org).
      const orgId = (c.get('actor') as Extract<Actor, { authenticated: true }>).orgId;
      const actor = c.get('actor') as Actor;
      const input = c.req.valid('json');
      const data = await createTutorAllocation(orgId, actor, input);
      return c.json({ success: true, data }, 201);
    } catch (error) {
      return handleError(c, error, 'Failed to create allocation');
    }
  })
  .delete('/:allocationId', requireManagerOrAdmin, zValidator('param', ZAllocationIdParam), async (c) => {
    try {
      // Org comes from the RESOLVED actor, never a client-supplied header — a Manager/Admin can only
      // ever act on their own org's allocations (single-org today; correct + header-proof for multi-org).
      const orgId = (c.get('actor') as Extract<Actor, { authenticated: true }>).orgId;
      const actor = c.get('actor') as Actor;
      const { allocationId } = c.req.valid('param');
      const data = await removeTutorAllocation(orgId, actor, allocationId);
      return c.json({ success: true, data }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to remove allocation');
    }
  });
