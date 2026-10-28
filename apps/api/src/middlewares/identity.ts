import * as Sentry from '@sentry/node';
import type { Context, MiddlewareHandler } from 'hono';

import { auth } from '@cio/db/auth';
import { resolveActor, ANONYMOUS_ACTOR } from '@cio/db/actor';
import { runWithRequestMemo } from '@cio/db/request-memo';
import { isPublicCorsPath } from '@api/middlewares/cors';

/**
 * PearlLMS scalability Phase C4 — the per-request identity pipeline (session + Actor).
 *
 * - The whole rest of the request runs inside a per-REQUEST memo scope (AsyncLocalStorage) so the better-auth
 *   customSession and resolveActor share ONE membership+status query — including /api/auth/get-session, whose
 *   handler would otherwise pay for it a second time. The memo dies with the request; nothing about role, status or
 *   allocation is cached across requests (docs/ACCESS.md §8), so deactivation / role changes bite on the next one.
 * - A DB/infrastructure failure while resolving the session or the Actor answers 503 + Retry-After. It must never
 *   fall through to the anonymous actor (a 401 would bounce a signed-in user to /login on a transient blip).
 */

const RETRY_AFTER_SECONDS = '2';

function identityUnavailable(c: Context) {
  c.header('Retry-After', RETRY_AFTER_SECONDS);

  return c.json(
    { success: false, error: 'Service temporarily unavailable, please retry', code: 'SERVICE_UNAVAILABLE' },
    503
  );
}

function setAnonymous(c: Context) {
  c.set('user', null);
  c.set('session', null);
  c.set('orgRoles', {});
  c.set('actor', ANONYMOUS_ACTOR);
}

export const identityMiddleware = (): MiddlewareHandler => async (c, next) => {
  if (isPublicCorsPath(c.req.path)) {
    setAnonymous(c);

    return next();
  }

  return runWithRequestMemo(async () => {
    let session: Awaited<ReturnType<typeof auth.api.getSession>> | null = null;

    try {
      session = await auth.api.getSession({ headers: c.req.raw.headers });
    } catch (error) {
      console.error('auth.api.getSession error:', error);

      return identityUnavailable(c);
    }

    if (!session) {
      setAnonymous(c);
      await next();

      return;
    }

    c.set('user', session.user);
    c.set('session', session.session);
    c.set('orgRoles', (session as { orgRoles?: Record<string, number> }).orgRoles ?? {});

    // Single authorization identity — resolved FRESH (role + status) from the DB so role changes and deactivations
    // take effect on the next request. Route guards consult c.get('actor').
    try {
      c.set('actor', await resolveActor(session.user.id, c.req.header('cio-org-id') ?? null));
    } catch (error) {
      console.error('resolveActor error:', error);

      return identityUnavailable(c);
    }

    Sentry.setUser({
      id: session.user.id,
      ...(session.user.email && { email: session.user.email }),
      ...(session.user.name && { username: session.user.name })
    });

    await next();
  });
};
