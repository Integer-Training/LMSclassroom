import { Context, Next } from 'hono';

import { ErrorCodes } from '@api/utils/errors';
import { apiKeyMiddleware } from '@api/middlewares/api-key';
import type { Actor } from '@cio/db/actor';
import type { Role } from '@cio/utils/constants';

// Actor-based role guards — the single, deny-by-default authorization primitive.
//
// These read `c.get('actor')` (set FRESH per request by resolveActor in app.ts), NOT the
// cookie-cached `orgRoles` map the legacy org-*/course-* middlewares use. That means a role
// change or a deactivation takes effect on the very next request, and a deactivated user with a
// live session is denied everywhere the Actor is consulted.
//
//  - not authenticated (anonymous / deactivated / no-membership / unknown-role) → 401
//  - authenticated but role not permitted                                       → 403

function unauthorized(c: Context) {
  return c.json({ success: false, error: 'Unauthorized', code: ErrorCodes.UNAUTHORIZED }, 401);
}

function forbidden(c: Context, message = 'You do not have permission to perform this action') {
  return c.json({ success: false, error: message, code: ErrorCodes.FORBIDDEN }, 403);
}

/** Any authenticated, active member (deny anonymous/deactivated). */
export function requireActor() {
  return async (c: Context, next: Next) => {
    const actor = c.get('actor') as Actor | undefined;
    if (!actor?.authenticated) return unauthorized(c);
    return next();
  };
}

/** Authenticated AND holding one of the given roles. */
export function requireRole(...roles: Role[]) {
  return async (c: Context, next: Next) => {
    const actor = c.get('actor') as Actor | undefined;
    if (!actor?.authenticated) return unauthorized(c);
    if (!roles.includes(actor.role)) return forbidden(c);
    return next();
  };
}

/** Admin only — user management, config, integrations, authoring, billing. */
export const requireAdmin = requireRole('ADMIN');

/** Admin or Tutor — the "staff" surfaces (marking is further ownership-gated per learner). */
export const requireStaff = requireRole('ADMIN', 'TUTOR');

/** Admin or Manager — provider-wide read (reports/dashboards; features land Phase 5). */
export const requireManagerOrAdmin = requireRole('MANAGER', 'ADMIN');

/**
 * Server-to-server via API key OR an ADMIN session — for admin actions that a machine (webhook /
 * automation) also performs, e.g. billing plan mutations. Closes the gap where authOrApiKey let
 * ANY authenticated user through on the session path (ACCESS.md gap I).
 */
export function requireAdminOrApiKey() {
  return async (c: Context, next: Next) => {
    const authHeader = c.req.header('Authorization');
    if (authHeader?.startsWith('Bearer ')) return apiKeyMiddleware(c, next);

    const actor = c.get('actor') as Actor | undefined;
    if (!actor?.authenticated) return unauthorized(c);
    if (actor.role !== 'ADMIN') return forbidden(c);
    return next();
  };
}

export { unauthorized, forbidden };
