import { forgetSession, getSessionState, type SessionState } from '$lib/utils/services/auth/session';
import { sessionUnavailableResponse } from '$lib/utils/session-unavailable';
import { getHasCioCookies } from '$lib/utils/functions/cookies';
import { applyCspExtensions } from '$lib/utils/csp';
import { applySecurityHeaders } from '$lib/utils/security-headers';
import { proxyRequestToApi, shouldForwardToApi } from '$lib/utils/proxy-api-request';
import { type Handle, type HandleServerError, type RequestEvent, redirect } from '@sveltejs/kit';
import { isPublicApiRoute, isPublicRoute } from '$lib/utils/functions/routes/isPublicRoute';
import { ROUTE } from '$lib/utils/constants/routes';

// PearlLMS Phase 10 — fire-and-forget POST to the API's /log/client endpoint (server-to-server, PRIVATE_SERVER_KEY).
// Best-effort: never awaited by callers, never throws, short timeout. The API masks the IP and caps fields.
type SsrLogEvent = {
  eventType: 'client.error' | 'auth.session_invalid_bounce';
  severity: 'info' | 'warn' | 'error';
  message?: string;
  stack?: string;
  path?: string;
  method?: string;
  httpStatus?: number;
  correlationId?: string;
};

function reportToApi(event: RequestEvent, payload: SsrLogEvent): void {
  try {
    const base = process.env.PRIVATE_SERVER_URL;
    const key = process.env.PRIVATE_SERVER_KEY;
    if (!base || !key) return;

    let ip: string | undefined;
    try {
      ip = event.getClientAddress();
    } catch {
      ip = undefined;
    }

    const user = (event.locals as { user?: { id?: string; email?: string } } | undefined)?.user;

    void fetch(`${base.replace(/\/$/, '')}/log/client`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ ...payload, ip, userId: user?.id, userEmail: user?.email }),
      signal: AbortSignal.timeout(3000)
    }).catch(() => {});
  } catch {
    // never throw from logging
  }
}

export const handleError: HandleServerError = ({ error, event, status, message }) => {
  const err = error as Error;
  // HP/SA-5 — full detail (stack/url) stays in the server log, keyed by a correlation id; the client only ever
  // sees a generic message + that id (returned below → $page.error), never the stack or internal path.
  const correlationId = crypto.randomUUID();
  console.error('[handleError]', {
    correlationId,
    status,
    message,
    method: event.request.method,
    url: event.url.toString(),
    name: err?.name,
    msg: err?.message,
    stack: err?.stack
  });

  // 401/403/404 are routine (expired link, wrong URL, no access) and would only flood the event log.
  if (status !== 401 && status !== 403 && status !== 404) {
    reportToApi(event, {
      eventType: 'client.error',
      severity: 'error',
      message: err?.message ?? message,
      stack: err?.stack,
      path: event.url.pathname,
      method: event.request.method,
      httpStatus: status,
      correlationId
    });
  }

  return {
    message: 'Something went wrong. Please try again, and quote this reference if it persists.',
    correlationId
  };
};

const ANALYTICS_SESSION_COOKIE = 'cio_aid';
const ANALYTICS_SESSION_MAX_AGE = 60 * 60 * 24 * 90;

function ensureAnalyticsSessionCookie(cookies: Parameters<Handle>[0]['event']['cookies']) {
  if (cookies.get(ANALYTICS_SESSION_COOKIE)) return;

  cookies.set(ANALYTICS_SESSION_COOKIE, crypto.randomUUID(), {
    path: '/',
    httpOnly: false,
    sameSite: 'lax',
    secure: true,
    maxAge: ANALYTICS_SESSION_MAX_AGE
  });
}

export const handle: Handle = async (args) => {
  const { event } = args;

  if (shouldForwardToApi(event.url.pathname)) {
    // Sign-in / sign-out change what these cookies mean: drop any memoised session for them (SSR_SESSION_MEMO_TTL_MS).
    if (isSessionBoundaryPath(event.url.pathname)) {
      forgetSession(event.cookies);
    }

    return proxyRequestToApi(event.request);
  }

  // PearlLMS Phase-10 HP/LOG-1 — removed debug logs that printed every cookie name=value (the session token is a
  // SECRET) and the page path. Never log raw cookies.
  // Tri-state (Phase C3): 'error' (API unreachable / timed out / 5xx) is NOT "logged out".
  const sessionState = await getSessionState(event.cookies);

  if (sessionState.status === 'session') {
    event.locals = sessionState.locals;
  }

  if (!event.url.pathname.includes('/api')) {
    ensureAnalyticsSessionCookie(event.cookies);
  }

  let response: Response;

  if (event.url.pathname.includes('/api')) {
    response = await handleAPIRoutes(args, sessionState);
  } else {
    response = await handlePagesRoutes(args, sessionState);
  }

  // Prevent Cloudflare/CDN from caching HTML pages — stale HTML references old
  // hashed JS/CSS bundles after a deploy, causing the app to hang on deep links.
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('text/html')) {
    response.headers.set('Cache-Control', 'private, no-cache, must-revalidate');
  }

  // PearlLMS Phase-10 HP/SA-1 — baseline security headers (defense-in-depth; also set at the Caddy proxy in
  // prod). HSTS only when the request is genuinely https (direct or via the proxy's X-Forwarded-Proto).
  const isSecure = event.url.protocol === 'https:' || event.request.headers.get('x-forwarded-proto') === 'https';
  return applySecurityHeaders(applyCspExtensions(response), isSecure);
};

function isSessionBoundaryPath(pathname: string): boolean {
  return pathname.startsWith('/api/auth/sign-out') || pathname.startsWith('/api/auth/sign-in');
}

type StatefulHandle = (input: Parameters<Handle>[0], sessionState: SessionState) => ReturnType<Handle>;

const handlePagesRoutes: StatefulHandle = async ({ event, resolve }, sessionState) => {
  const { pathname } = event.url;
  const hasCioCookie = getHasCioCookies(event.cookies);

  if (isPublicRoute(pathname)) {
    return resolve(event);
  }

  // The session check itself failed: show a retry page. Never redirect to /login (the login page calls get-session
  // too, so that would loop) and never report a session_invalid_bounce for a transport error.
  if (sessionState.status === 'error') {
    return sessionUnavailableResponse('page');
  }

  // Session cookie present but the session did not resolve => stale/invalid session (logged best-effort).
  if (!event?.locals?.user && hasCioCookie && !pathname.includes(ROUTE.LOGOUT)) {
    reportToApi(event, {
      eventType: 'auth.session_invalid_bounce',
      severity: 'warn',
      path: pathname,
      method: event.request.method
    });
  }

  if (!event?.locals?.user && !hasCioCookie) {
    const shouldAddRedirectParam = !pathname.includes(ROUTE.LOGOUT);
    const fullPath = pathname + event.url.search;
    const redirectPath = shouldAddRedirectParam
      ? `${ROUTE.LOGIN}?redirect=${encodeURIComponent(fullPath)}`
      : ROUTE.LOGIN;

    return redirect(303, redirectPath);
  }

  return resolve(event);
};

const handleAPIRoutes: StatefulHandle = async ({ event, resolve }, sessionState) => {
  const { pathname } = event.url;

  if (isPublicApiRoute(pathname)) {
    return resolve(event);
  }

  if (sessionState.status === 'error') {
    return sessionUnavailableResponse('api');
  }

  if (!event.locals.user) {
    if (getHasCioCookies(event.cookies)) {
      reportToApi(event, {
        eventType: 'auth.session_invalid_bounce',
        severity: 'warn',
        path: pathname,
        method: event.request.method
      });
    }
    redirect(303, '/login');
  }

  return resolve(event);
};
